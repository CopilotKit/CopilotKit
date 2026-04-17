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
  ManifestMalformedError,
  ManifestUnreadableError,
} from "../validate-parity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PARITY_SCRIPT = path.resolve(__dirname, "..", "validate-parity.ts");

// Shared tmpdir populated by beforeAll with all the "static" fixture
// packages (ok-pkg, missing-manifest, missing-demo-dir, missing-spec,
// spec-exceeds, spec-less). Malformed / empty / scalar fixtures are
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
  // test file left one on disk (it shouldn't), we create a fresh one so
  // the seedStaticFixtures contract isn't corrupted. Wrap seed in
  // try/catch so a partial fixture tree is torn down before rethrowing
  // — otherwise later tests inherit a FIXTURES_DIR with half a tree and
  // produce mysterious failures.
  FIXTURES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "parity-fixtures-"));
  try {
    seedStaticFixtures(FIXTURES_DIR);
  } catch (err) {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
    throw err;
  }
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
  // Belt-and-braces cleanup: each nested describe block below may mutate
  // VALIDATE_PARITY_REPO_ROOT / VALIDATE_PARITY_BASELINE in subprocesses,
  // but if any in-process test forgets to unset them, the next describe
  // would inherit stale values. Clear before every test and restore
  // after — afterAll still handles end-of-file restoration.
  beforeEach(() => {
    delete process.env.VALIDATE_PARITY_REPO_ROOT;
    delete process.env.VALIDATE_PARITY_BASELINE;
  });

  afterEach(() => {
    delete process.env.VALIDATE_PARITY_REPO_ROOT;
    delete process.env.VALIDATE_PARITY_BASELINE;
  });

  describe("loadManifest", () => {
    it("returns null when manifest.yaml is missing", () => {
      const result = loadManifest("missing-manifest", FIXTURES_DIR);
      expect(result).toBeNull();
    });

    it("throws ManifestMalformedError on malformed YAML", () => {
      // loadManifest signals malformed input distinctly from "missing" by
      // throwing a typed ManifestMalformedError; auditPackage converts
      // that into a mustError.
      const tmp = makeMalformedManifestDir();
      try {
        expect(() => loadManifest("malformed", tmp)).toThrow(
          ManifestMalformedError,
        );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("throws ManifestUnreadableError on read failure", () => {
      // Simulate readFileSync throwing EACCES to exercise the
      // "unreadable" branch of parseManifest, which loadManifest
      // surfaces as a typed ManifestUnreadableError. Fall through to
      // the real readFileSync for unrelated paths so Vitest / tsx
      // internals aren't broken.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-unreadable-"));
      try {
        const pkgDir = path.join(tmp, "unreadable");
        fs.mkdirSync(pkgDir, { recursive: true });
        const manifestPath = path.join(pkgDir, "manifest.yaml");
        fs.writeFileSync(manifestPath, "slug: x\n", "utf-8");
        const realReadFileSync = fs.readFileSync;
        const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((
          p: fs.PathOrFileDescriptor,
          ...rest: unknown[]
        ) => {
          if (typeof p === "string" && p.endsWith("manifest.yaml")) {
            const e: NodeJS.ErrnoException = Object.assign(
              new Error("EACCES: permission denied"),
              { code: "EACCES" },
            );
            throw e;
          }
          // Fall through for unrelated reads to avoid breaking the
          // runtime infrastructure mid-test.
          return (
            realReadFileSync as unknown as (
              p: fs.PathOrFileDescriptor,
              ...rest: unknown[]
            ) => unknown
          )(p, ...rest);
        }) as typeof fs.readFileSync);
        try {
          expect(() => loadManifest("unreadable", tmp)).toThrow(
            ManifestUnreadableError,
          );
        } finally {
          readSpy.mockRestore();
        }
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
      const categories = report.mustErrors.map((e) => e.category);
      expect(categories).toContain("missing-manifest");
      const messages = report.mustErrors.map((e) => e.message);
      expect(messages).toContain("missing manifest.yaml");
    });

    it("flags malformed YAML as a MUST error instead of crashing", () => {
      // The validator must survive a malformed manifest so sibling packages
      // still get validated. This is the core "one bad apple" regression.
      const tmp = makeMalformedManifestDir();
      try {
        const report = auditPackage("malformed", tmp);
        expect(report.mustErrors.length).toBeGreaterThan(0);
        expect(report.mustErrors[0].category).toBe("malformed-manifest");
        expect(report.mustErrors[0].message).toMatch(
          /unparseable manifest\.yaml/,
        );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("distinguishes unreadable from malformed in the mustError category", () => {
      // parseManifest reports "unreadable" when readFileSync throws
      // (permissions, I/O). loadManifest wraps that in
      // ManifestUnreadableError. auditPackage discriminates with
      // `instanceof` and assigns the category "unreadable-manifest".
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-unreadable-"));
      try {
        const pkgDir = path.join(tmp, "unreadable");
        fs.mkdirSync(pkgDir, { recursive: true });
        const manifestPath = path.join(pkgDir, "manifest.yaml");
        fs.writeFileSync(manifestPath, "slug: x\n", "utf-8");
        const realReadFileSync = fs.readFileSync;
        const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((
          p: fs.PathOrFileDescriptor,
          ...rest: unknown[]
        ) => {
          if (typeof p === "string" && p.endsWith("manifest.yaml")) {
            const e: NodeJS.ErrnoException = Object.assign(
              new Error("EACCES: permission denied"),
              { code: "EACCES" },
            );
            throw e;
          }
          return (
            realReadFileSync as unknown as (
              p: fs.PathOrFileDescriptor,
              ...rest: unknown[]
            ) => unknown
          )(p, ...rest);
        }) as typeof fs.readFileSync);
        try {
          const report = auditPackage("unreadable", tmp);
          expect(report.mustErrors.length).toBeGreaterThan(0);
          expect(report.mustErrors[0].category).toBe("unreadable-manifest");
          expect(report.mustErrors[0].message).toMatch(
            /unreadable manifest\.yaml/,
          );
          expect(report.mustErrors[0].message).not.toMatch(/unparseable/);
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
        expect(
          report.mustErrors.some((e) => /manifest\.yaml/.test(e.message)),
        ).toBe(true);
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
        expect(
          report.mustErrors.some((e) => /manifest\.yaml/.test(e.message)),
        ).toBe(true);
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
      expect(
        report.mustErrors.some(
          (e) =>
            e.category === "missing-demo-dir" &&
            /demos\/chat\//.test(e.message),
        ),
      ).toBe(true);
    });

    it("flags a demo with no spec file as a WARNING, not a MUST error", () => {
      const report = auditPackage("missing-spec", FIXTURES_DIR);
      expect(report.mustErrors).toEqual([]);
      expect(
        report.warnings.some(
          (w) =>
            w.category === "missing-spec" &&
            /no tests\/e2e\/chat\.spec\.ts/.test(w.message),
        ),
      ).toBe(true);
    });

    it("does NOT warn when spec count exceeds demo count (legitimate extras)", () => {
      // A cross-demo spec (e.g. one covering renderer selection) is allowed.
      const report = auditPackage("spec-exceeds", FIXTURES_DIR);
      expect(
        report.warnings.some((w) => w.category === "spec-under-coverage"),
      ).toBe(false);
    });

    it("does NOT warn when spec count equals demo count (equality boundary)", () => {
      // Pin the boundary: the under-coverage warning uses strict `<`, so an
      // exact match must not warn. Regression guard against accidentally
      // tightening the comparison.
      const report = auditPackage("spec-equal", FIXTURES_DIR);
      expect(
        report.warnings.some((w) => w.category === "spec-under-coverage"),
      ).toBe(false);
    });

    it("warns when spec count is less than demo count", () => {
      const report = auditPackage("spec-less", FIXTURES_DIR);
      expect(
        report.warnings.some(
          (w) =>
            w.category === "spec-under-coverage" &&
            /spec count.*<.*demo count/.test(w.message),
        ),
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

    it("listDirs returns empty ListResult for a non-existent path without throwing", () => {
      const result = listDirs(path.join(tmpDir, "does-not-exist"));
      expect(result.entries).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("listFiles returns empty ListResult for a non-existent path without throwing", () => {
      const result = listFiles(path.join(tmpDir, "does-not-exist"), ".md");
      expect(result.entries).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("listDirs returns empty entries + a listing-failed warning on readdir failure", () => {
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
        const result = listDirs(blocked);
        expect(result.entries).toEqual([]);
        // The stderr log fires — assert on a pattern, not exact call count,
        // to keep the contract loose enough to survive future refactors.
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/\[WARN\] failed to read directory .*blocked/),
        );
        // And the warning is ALSO returned in the ListResult — ensures
        // summary counts match what we emit on stderr.
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0].category).toBe("listing-failed");
        expect(result.warnings[0].message).toMatch(
          /failed to read directory .*blocked/,
        );
      } finally {
        readdirSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it("listFiles returns empty entries + a listing-failed warning on readdir failure", () => {
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
        const result = listFiles(blocked, ".md");
        expect(result.entries).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(
            /\[WARN\] failed to read directory .*blocked-files/,
          ),
        );
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0].category).toBe("listing-failed");
        expect(result.warnings[0].message).toMatch(
          /failed to read directory .*blocked-files/,
        );
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

      expect(listDirs(dir).entries).toEqual(["alpha", "mu", "zeta"]);
      expect(listFiles(dir, ".md").entries).toEqual([
        "alpha.md",
        "mu.md",
        "zeta.md",
      ]);
    });
  });

  describe("module exports", () => {
    it("exports the functions tests need", () => {
      expect(typeof auditPackage).toBe("function");
      expect(typeof loadManifest).toBe("function");
      expect(typeof listFiles).toBe("function");
      expect(typeof listDirs).toBe("function");
    });

    it("does not invoke main() on import (isMain guard is in place)", () => {
      // A dynamic `await import(...)` in-process is trivially
      // non-throwing because the module was already loaded earlier in
      // this test file, so we probe via a fresh subprocess that imports
      // the script without invoking it (no direct argv match). Any
      // exit code other than 0 indicates main() ran on import.
      const probe = `
        import("${PARITY_SCRIPT.replace(/\\/g, "\\\\")}").then(() => {
          process.exit(0);
        }).catch((err) => {
          console.error(err?.stack ?? err);
          process.exit(2);
        });
      `;
      // Use NODE_OPTIONS to load tsx's ESM loader so the dynamic import
      // of a .ts file succeeds. stdout/stderr captured for diagnostics.
      const r = spawnSync("node", ["--import", "tsx", "-e", probe], {
        encoding: "utf-8",
        timeout: 30_000,
        env: { ...process.env },
      });
      expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
      // Importing the module for side effects only — stdout should be
      // empty because main() was NOT invoked (no pass/summary table).
      expect(r.stdout).not.toMatch(/package\(s\) checked/);
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

    it("exits 3 (unreadable) when readdirSync on packages dir throws", () => {
      // Make packages/ exist but unreadable by the current process. Rather
      // than chmod 0 (flaky as root / on Windows), we invoke the script
      // with a packages dir that resolves to a regular file instead of a
      // directory — existsSync succeeds, readdirSync throws ENOTDIR. This
      // exercises the post-existsSync readdirSync-throws branch.
      fs.rmSync(tree.packagesDir, { recursive: true, force: true });
      fs.writeFileSync(tree.packagesDir, "not a dir", "utf-8");
      const r = runCli([], {
        env: { VALIDATE_PARITY_REPO_ROOT: tree.root },
      });
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(3);
      expect(r.stderr).toMatch(/could not read packages directory/);
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

    it("honors --baseline=N and emits a baseline-deviation warning at the given value", () => {
      // One demo with baseline=5 → deviation warning
      writeFixturePackage(tree.packagesDir, "only-pkg", {
        manifest: "slug: only-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
        demoDirs: ["chat"],
        specFiles: ["chat.spec.ts"],
        qaFiles: ["chat.md"],
      });
      const r = runCli(["--baseline=5"], {
        env: { VALIDATE_PARITY_REPO_ROOT: tree.root },
      });
      // Exit 0 because deviation is a SHOULD warning, not a MUST error.
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(0);
      expect(r.stderr).toMatch(/demo count 1 deviates from baseline 5/);
    });

    it("honors VALIDATE_PARITY_BASELINE env and emits a baseline-deviation warning", () => {
      writeFixturePackage(tree.packagesDir, "only-pkg", {
        manifest: "slug: only-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
        demoDirs: ["chat"],
        specFiles: ["chat.spec.ts"],
        qaFiles: ["chat.md"],
      });
      const r = runCli([], {
        env: {
          VALIDATE_PARITY_REPO_ROOT: tree.root,
          VALIDATE_PARITY_BASELINE: "3",
        },
      });
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(0);
      expect(r.stderr).toMatch(/demo count 1 deviates from baseline 3/);
    });

    it.each([
      ["abc"],
      ["NaN"],
      ["0"],
      ["-1"],
      ["1.5"],
      ["  "],
      ["0x10"],
      ["1e2"],
    ])(
      "rejects invalid VALIDATE_PARITY_BASELINE=%j with exit 1",
      (raw: string) => {
        writeFixturePackage(tree.packagesDir, "only-pkg", {
          manifest: "slug: only-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
          demoDirs: ["chat"],
          specFiles: ["chat.spec.ts"],
          qaFiles: ["chat.md"],
        });
        const r = runCli([], {
          env: {
            VALIDATE_PARITY_REPO_ROOT: tree.root,
            VALIDATE_PARITY_BASELINE: raw,
          },
        });
        expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(1);
        expect(r.stderr).toMatch(/VALIDATE_PARITY_BASELINE/);
      },
    );

    it("rejects invalid --baseline=abc with exit 1", () => {
      writeFixturePackage(tree.packagesDir, "only-pkg", {
        manifest: "slug: only-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
        demoDirs: ["chat"],
        specFiles: ["chat.spec.ts"],
        qaFiles: ["chat.md"],
      });
      const r = runCli(["--baseline=abc"], {
        env: { VALIDATE_PARITY_REPO_ROOT: tree.root },
      });
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(1);
      expect(r.stderr).toMatch(/invalid --baseline value/);
    });
  });
});
