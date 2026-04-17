/**
 * Tests for showcase parity validator.
 *
 * Builds fixture package trees inside a per-suite tmpdir instead of relying on
 * committed fixtures under __tests__/fixtures/parity/. The committed tree is
 * incomplete (missing src/app/demos/<id>/ entries because empty dirs don't
 * survive git), so materialising the whole tree at setup keeps the tests
 * self-contained and unaffected by what does / doesn't get committed.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import {
  auditPackage,
  loadManifest,
  listFiles,
  listDirs,
} from "../validate-parity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PARITY_SCRIPT = path.resolve(__dirname, "..", "validate-parity.ts");

// Shared tmpdir populated by beforeAll with all the "static" fixture
// packages (ok-pkg, missing-manifest, missing-demo-dir, missing-spec,
// spec-exceeds, spec-less). Malformed / empty / scalar fixtures are still
// built in per-test tmpdirs because they exercise distinct crash paths.
let FIXTURES_DIR: string;
// Save cwd / env to restore in afterAll — avoids cross-file pollution if
// any individual test temporarily swaps them.
const ORIGINAL_CWD = process.cwd();
const ORIGINAL_PARITY_ROOT = process.env.VALIDATE_PARITY_REPO_ROOT;
const ORIGINAL_PARITY_BASELINE = process.env.VALIDATE_PARITY_BASELINE;

function writeFixturePackage(
  root: string,
  slug: string,
  opts: {
    manifest?: string;
    demoDirs?: string[];
    specFiles?: string[];
    qaFiles?: string[];
  },
) {
  const pkgDir = path.join(root, slug);
  fs.mkdirSync(pkgDir, { recursive: true });
  if (opts.manifest !== undefined) {
    fs.writeFileSync(
      path.join(pkgDir, "manifest.yaml"),
      opts.manifest,
      "utf-8",
    );
  }
  for (const id of opts.demoDirs ?? []) {
    fs.mkdirSync(path.join(pkgDir, "src", "app", "demos", id), {
      recursive: true,
    });
  }
  if (opts.specFiles?.length) {
    const e2eDir = path.join(pkgDir, "tests", "e2e");
    fs.mkdirSync(e2eDir, { recursive: true });
    for (const name of opts.specFiles) {
      fs.writeFileSync(path.join(e2eDir, name), "", "utf-8");
    }
  }
  if (opts.qaFiles?.length) {
    const qaDir = path.join(pkgDir, "qa");
    fs.mkdirSync(qaDir, { recursive: true });
    for (const name of opts.qaFiles) {
      fs.writeFileSync(path.join(qaDir, name), "", "utf-8");
    }
  }
}

function seedStaticFixtures(root: string) {
  // ok-pkg: 1 demo, 1 spec, 1 qa, demo dir present → no errors, no warnings
  // except baseline (1 != 9) which tests don't assert on here.
  writeFixturePackage(root, "ok-pkg", {
    manifest: "slug: ok-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
    demoDirs: ["chat"],
    specFiles: ["chat.spec.ts"],
    qaFiles: ["chat.md"],
  });

  // missing-manifest: directory exists but no manifest.yaml
  fs.mkdirSync(path.join(root, "missing-manifest"), { recursive: true });

  // missing-demo-dir: manifest declares chat but no src/app/demos/chat/
  writeFixturePackage(root, "missing-demo-dir", {
    manifest: "slug: missing-demo-dir\ndemos:\n  - id: chat\n    name: Chat\n",
  });

  // missing-spec: demo dir present, qa present, spec absent → WARNING only
  writeFixturePackage(root, "missing-spec", {
    manifest: "slug: missing-spec\ndemos:\n  - id: chat\n    name: Chat\n",
    demoDirs: ["chat"],
    qaFiles: ["chat.md"],
  });

  // spec-exceeds: spec count > demo count (legitimate cross-demo extras)
  writeFixturePackage(root, "spec-exceeds", {
    manifest: "slug: spec-exceeds\ndemos:\n  - id: chat\n    name: Chat\n",
    demoDirs: ["chat"],
    specFiles: ["chat.spec.ts", "renderer-selector.spec.ts"],
    qaFiles: ["chat.md"],
  });

  // spec-less: 2 demos, only 1 spec → WARNING for under-coverage
  writeFixturePackage(root, "spec-less", {
    manifest:
      "slug: spec-less\ndemos:\n  - id: chat\n    name: Chat\n  - id: tools\n    name: Tools\n",
    demoDirs: ["chat", "tools"],
    specFiles: ["chat.spec.ts"],
    qaFiles: ["chat.md", "tools.md"],
  });

  // spec-equal-demos: exactly spec count == demo count → NO warning
  writeFixturePackage(root, "spec-equal", {
    manifest: "slug: spec-equal\ndemos:\n  - id: chat\n    name: Chat\n",
    demoDirs: ["chat"],
    specFiles: ["chat.spec.ts"],
    qaFiles: ["chat.md"],
  });
}

// Malformed-YAML fixtures are written to a throwaway tmpdir at test time
// rather than committed to the repo, because repo-level oxfmt / prettier /
// YAML linters would reject an intentionally broken .yaml fixture.
function makeMalformedManifestDir(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-malformed-"));
  const pkgDir = path.join(tmp, "malformed");
  fs.mkdirSync(path.join(pkgDir, "src", "app", "demos", "chat"), {
    recursive: true,
  });
  // Invalid YAML: unclosed flow sequence inside a mapping value.
  fs.writeFileSync(
    path.join(pkgDir, "manifest.yaml"),
    "slug: malformed\ndemos:\n  - id: chat\n    name: Chat\n  invalid: [unclosed\n",
    "utf-8",
  );
  return tmp;
}

// Build a tree that main() expects: <root>/packages/<slug>/... so
// VALIDATE_PARITY_REPO_ROOT can point at the root.
function makeMainTree(): { root: string; packagesDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parity-main-"));
  const packagesDir = path.join(root, "packages");
  fs.mkdirSync(packagesDir, { recursive: true });
  return { root, packagesDir };
}

beforeAll(() => {
  // Idempotent: only create the fixtures directory once. If a previous
  // test file left one on disk (it shouldn't), we still create a fresh
  // one so the seedStaticFixtures contract isn't corrupted.
  FIXTURES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "parity-fixtures-"));
  seedStaticFixtures(FIXTURES_DIR);
});

afterAll(() => {
  if (FIXTURES_DIR) {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  }
  // Restore any env / cwd state in case a subprocess test mutated the
  // parent process's environment inadvertently.
  if (process.cwd() !== ORIGINAL_CWD) {
    process.chdir(ORIGINAL_CWD);
  }
  if (ORIGINAL_PARITY_ROOT === undefined) {
    delete process.env.VALIDATE_PARITY_REPO_ROOT;
  } else {
    process.env.VALIDATE_PARITY_REPO_ROOT = ORIGINAL_PARITY_ROOT;
  }
  if (ORIGINAL_PARITY_BASELINE === undefined) {
    delete process.env.VALIDATE_PARITY_BASELINE;
  } else {
    process.env.VALIDATE_PARITY_BASELINE = ORIGINAL_PARITY_BASELINE;
  }
});

describe("validate-parity", () => {
  describe("loadManifest", () => {
    it("returns null when manifest.yaml is missing", () => {
      const result = loadManifest("missing-manifest", FIXTURES_DIR);
      expect(result).toBeNull();
    });

    it("throws on malformed YAML", () => {
      // loadManifest signals malformed input distinctly from "missing" by
      // throwing; auditPackage converts that into a mustError.
      const tmp = makeMalformedManifestDir();
      try {
        expect(() => loadManifest("malformed", tmp)).toThrow(/\[malformed\]/);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("parses a valid manifest", () => {
      const result = loadManifest("ok-pkg", FIXTURES_DIR);
      expect(result).not.toBeNull();
      expect(result?.slug).toBe("ok-pkg");
      expect(result?.demos?.[0].id).toBe("chat");
    });
  });

  describe("auditPackage", () => {
    it("returns no errors for a valid package", () => {
      const report = auditPackage("ok-pkg", FIXTURES_DIR);
      expect(report.mustErrors).toEqual([]);
    });

    it("flags missing manifest as a MUST error", () => {
      const report = auditPackage("missing-manifest", FIXTURES_DIR);
      expect(report.mustErrors).toContain("missing manifest.yaml");
    });

    it("flags malformed YAML as a MUST error instead of crashing", () => {
      // The validator must survive a malformed manifest so sibling packages
      // still get validated. This is the core "one bad apple" regression.
      const tmp = makeMalformedManifestDir();
      try {
        const report = auditPackage("malformed", tmp);
        expect(report.mustErrors.length).toBeGreaterThan(0);
        expect(report.mustErrors[0]).toMatch(/unparseable manifest\.yaml/);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("distinguishes unreadable from malformed in the mustError message", () => {
      // parseManifest reports "unreadable" when readFileSync throws
      // (permissions, I/O). loadManifest tags the throw with [unreadable]
      // so auditPackage can emit a different message than for [malformed].
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-unreadable-"));
      try {
        const pkgDir = path.join(tmp, "unreadable");
        fs.mkdirSync(pkgDir, { recursive: true });
        const manifestPath = path.join(pkgDir, "manifest.yaml");
        fs.writeFileSync(manifestPath, "slug: x\n", "utf-8");
        const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((
          p: fs.PathOrFileDescriptor,
        ) => {
          if (typeof p === "string" && p.endsWith("manifest.yaml")) {
            const e: NodeJS.ErrnoException = Object.assign(
              new Error("EACCES: permission denied"),
              { code: "EACCES" },
            );
            throw e;
          }
          // Fall through for unrelated reads (none expected in this test).
          return "" as unknown as Buffer;
        }) as typeof fs.readFileSync);
        try {
          const report = auditPackage("unreadable", tmp);
          expect(report.mustErrors.length).toBeGreaterThan(0);
          expect(report.mustErrors[0]).toMatch(/unreadable manifest\.yaml/);
          expect(report.mustErrors[0]).not.toMatch(/unparseable/);
        } finally {
          readSpy.mockRestore();
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("flags an empty manifest.yaml as a MUST error instead of crashing", () => {
      // yaml.parse("") returns null. Without a type guard, reading
      // `.demos` on the parsed value crashes auditPackage. This test pins
      // the expected behaviour: empty YAML is reported as an invalid
      // manifest rather than letting null propagate into `.demos?.length`.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-empty-"));
      try {
        const pkgDir = path.join(tmp, "empty");
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, "manifest.yaml"), "", "utf-8");
        const report = auditPackage("empty", tmp);
        expect(report.mustErrors.length).toBeGreaterThan(0);
        expect(report.mustErrors.some((e) => /manifest\.yaml/.test(e))).toBe(
          true,
        );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("flags a non-object manifest.yaml (scalar) as a MUST error", () => {
      // A YAML file whose top-level value is a scalar (e.g. 'hello') parses
      // to the string 'hello' — truthy but not a valid Manifest. Without a
      // type guard the validator silently treats it as a manifest with no
      // demos. Pin stricter behaviour: reject non-object values.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-scalar-"));
      try {
        const pkgDir = path.join(tmp, "scalar");
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(
          path.join(pkgDir, "manifest.yaml"),
          "hello\n",
          "utf-8",
        );
        const report = auditPackage("scalar", tmp);
        expect(report.mustErrors.length).toBeGreaterThan(0);
        expect(report.mustErrors.some((e) => /manifest\.yaml/.test(e))).toBe(
          true,
        );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("continues validating other packages after a malformed manifest", () => {
      // Auditing the malformed fixture should NOT throw, so auditing a
      // later package is unaffected.
      const tmp = makeMalformedManifestDir();
      try {
        expect(() => auditPackage("malformed", tmp)).not.toThrow();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      const ok = auditPackage("ok-pkg", FIXTURES_DIR);
      expect(ok.mustErrors).toEqual([]);
    });

    it("flags a demo with no src/app/demos/<id>/ as a MUST error", () => {
      const report = auditPackage("missing-demo-dir", FIXTURES_DIR);
      expect(report.mustErrors.some((e) => /demos\/chat\//.test(e))).toBe(true);
    });

    it("flags a demo with no spec file as a WARNING, not a MUST error", () => {
      const report = auditPackage("missing-spec", FIXTURES_DIR);
      expect(report.mustErrors).toEqual([]);
      expect(
        report.warnings.some((w) => /no tests\/e2e\/chat\.spec\.ts/.test(w)),
      ).toBe(true);
    });

    it("does NOT warn when spec count exceeds demo count (legitimate extras)", () => {
      // A cross-demo spec (e.g. one covering renderer selection) is allowed.
      const report = auditPackage("spec-exceeds", FIXTURES_DIR);
      expect(
        report.warnings.some((w) => /spec count.*demo count/.test(w)),
      ).toBe(false);
    });

    it("does NOT warn when spec count equals demo count (equality boundary)", () => {
      // Pin the boundary: the under-coverage warning uses strict `<`, so an
      // exact match must not warn. Regression guard against accidentally
      // tightening the comparison.
      const report = auditPackage("spec-equal", FIXTURES_DIR);
      expect(
        report.warnings.some((w) => /spec count.*<.*demo count/.test(w)),
      ).toBe(false);
    });

    it("warns when spec count is less than demo count", () => {
      const report = auditPackage("spec-less", FIXTURES_DIR);
      expect(
        report.warnings.some((w) => /spec count.*<.*demo count/.test(w)),
      ).toBe(true);
    });
  });

  describe("listDirs / listFiles graceful error handling", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-test-"));
    });

    afterEach(() => {
      // Restore permissions so cleanup succeeds, then rm. If chmod fails,
      // let it throw — swallowing it silently would hide test-pollution.
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("listDirs returns [] for a non-existent path without throwing", () => {
      expect(listDirs(path.join(tmpDir, "does-not-exist"))).toEqual([]);
    });

    it("listFiles returns [] for a non-existent path without throwing", () => {
      expect(listFiles(path.join(tmpDir, "does-not-exist"), ".md")).toEqual([]);
    });

    it("listDirs returns [] and logs a warning on readdir failure", () => {
      // Mock readdirSync to throw — avoids chmod-based tests that fail
      // as root or on Windows and that leave behind tmpdirs that
      // cleanup can't remove.
      const blocked = path.join(tmpDir, "blocked");
      fs.mkdirSync(blocked);

      const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const readdirSpy = vi
        .spyOn(fs, "readdirSync")
        .mockImplementation((): never => {
          const e: NodeJS.ErrnoException = Object.assign(
            new Error("EACCES: permission denied"),
            { code: "EACCES" },
          );
          throw e;
        });
      try {
        const warnings: string[] = [];
        const result = listDirs(blocked, warnings);
        expect(result).toEqual([]);
        // The stderr log fires — assert on a pattern, not exact call count,
        // to keep the contract loose enough to survive future refactors.
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/\[WARN\] failed to read directory .*blocked/),
        );
        // And the warning is ALSO pushed into the passed-in warnings array
        // — ensures summary counts match what we emit on stderr.
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toMatch(/failed to read directory .*blocked/);
      } finally {
        readdirSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it("listFiles returns [] and logs a warning on readdir failure", () => {
      const blocked = path.join(tmpDir, "blocked-files");
      fs.mkdirSync(blocked);

      const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const readdirSpy = vi
        .spyOn(fs, "readdirSync")
        .mockImplementation((): never => {
          const e: NodeJS.ErrnoException = Object.assign(
            new Error("EACCES: permission denied"),
            { code: "EACCES" },
          );
          throw e;
        });
      try {
        const warnings: string[] = [];
        const result = listFiles(blocked, ".md", warnings);
        expect(result).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(
            /\[WARN\] failed to read directory .*blocked-files/,
          ),
        );
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toMatch(/failed to read directory .*blocked-files/);
      } finally {
        readdirSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it("listDirs / listFiles return results in sorted order", () => {
      // Filesystems don't guarantee iteration order, so auditPackage's
      // reports could flake without explicit sorting. Pin sorted output.
      const dir = path.join(tmpDir, "ordering");
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(dir, "zeta"));
      fs.mkdirSync(path.join(dir, "alpha"));
      fs.mkdirSync(path.join(dir, "mu"));
      fs.writeFileSync(path.join(dir, "zeta.md"), "", "utf-8");
      fs.writeFileSync(path.join(dir, "alpha.md"), "", "utf-8");
      fs.writeFileSync(path.join(dir, "mu.md"), "", "utf-8");

      expect(listDirs(dir)).toEqual(["alpha", "mu", "zeta"]);
      expect(listFiles(dir, ".md")).toEqual(["alpha.md", "mu.md", "zeta.md"]);
    });
  });

  describe("module exports", () => {
    it("exports the functions tests need", () => {
      expect(typeof auditPackage).toBe("function");
      expect(typeof loadManifest).toBe("function");
      expect(typeof listFiles).toBe("function");
      expect(typeof listDirs).toBe("function");
    });

    it("does not invoke main() on import (isMain guard is in place)", async () => {
      // If main() ran on import, the test runner would have exited by now
      // or fs.readdirSync(PACKAGES_DIR) would have side-effected in a way
      // we'd catch. This test simply re-imports the module and verifies no
      // throw — main() walking the real packages dir during a vitest run
      // would cause process.exit() calls we don't want.
      //
      // Note: `expect(asyncFn).not.toThrow()` is always trivially true
      // (toThrow does not await the returned promise), so we use
      // `.resolves.not.toThrow()` to actually await the dynamic import.
      await expect(
        (async () => {
          await import("../validate-parity.js");
        })(),
      ).resolves.not.toThrow();
    });
  });

  describe("main() exit codes via CLI subprocess", () => {
    let tree: { root: string; packagesDir: string };

    beforeEach(() => {
      tree = makeMainTree();
    });

    afterEach(() => {
      fs.rmSync(tree.root, { recursive: true, force: true });
    });

    function runCli(args: string[], opts: { env?: NodeJS.ProcessEnv } = {}) {
      return spawnSync("npx", ["tsx", PARITY_SCRIPT, ...args], {
        env: { ...process.env, ...opts.env },
        encoding: "utf-8",
        timeout: 30_000,
      });
    }

    it("exits 0 when there are no MUST failures", () => {
      writeFixturePackage(tree.packagesDir, "ok-pkg", {
        manifest: "slug: ok-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
        demoDirs: ["chat"],
        specFiles: ["chat.spec.ts"],
        qaFiles: ["chat.md"],
      });
      const r = runCli([], {
        env: { VALIDATE_PARITY_REPO_ROOT: tree.root },
      });
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(0);
    });

    it("exits 1 when a MUST failure is present", () => {
      // missing demos/<id>/ dir triggers a MUST failure.
      writeFixturePackage(tree.packagesDir, "bad", {
        manifest: "slug: bad\ndemos:\n  - id: chat\n    name: Chat\n",
      });
      const r = runCli([], {
        env: { VALIDATE_PARITY_REPO_ROOT: tree.root },
      });
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(1);
    });

    it("exits 3 (unreadable) when packages dir does not exist", () => {
      // tree.root exists but packages/ was just removed.
      fs.rmSync(tree.packagesDir, { recursive: true, force: true });
      const r = runCli([], {
        env: { VALIDATE_PARITY_REPO_ROOT: tree.root },
      });
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(3);
      expect(r.stderr).toMatch(/packages/i);
    });

    it("respects VALIDATE_PARITY_REPO_ROOT env-var override", () => {
      // Populate the fixture root and assert main() honors the env var
      // rather than the default packages dir (which would walk real
      // packages under showcase/packages/).
      writeFixturePackage(tree.packagesDir, "only-pkg", {
        manifest: "slug: only-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
        demoDirs: ["chat"],
        specFiles: ["chat.spec.ts"],
        qaFiles: ["chat.md"],
      });
      const r = runCli([], {
        env: { VALIDATE_PARITY_REPO_ROOT: tree.root },
      });
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(0);
      // The summary line counts packages; with the env-var honored we should
      // see exactly 1 (the fixture), not the real showcase slug count.
      expect(r.stdout).toMatch(/1 package\(s\) checked/);
    });
  });
});
