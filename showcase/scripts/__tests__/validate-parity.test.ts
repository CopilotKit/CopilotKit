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
  runParity,
  coerceBaseline,
  deriveMessage,
  HEADER_COLUMNS,
  formatRow,
  buildHeader,
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
      const messages = report.mustErrors.map((e) => deriveMessage(e));
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
        expect(deriveMessage(report.mustErrors[0])).toMatch(
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
          expect(deriveMessage(report.mustErrors[0])).toMatch(
            /unreadable manifest\.yaml/,
          );
          expect(deriveMessage(report.mustErrors[0])).not.toMatch(
            /unparseable/,
          );
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
          report.mustErrors.some((e) =>
            /manifest\.yaml/.test(deriveMessage(e)),
          ),
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
          report.mustErrors.some((e) =>
            /manifest\.yaml/.test(deriveMessage(e)),
          ),
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
            /demos\/chat\//.test(deriveMessage(e)),
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
            /no tests\/e2e\/chat\.spec\.ts/.test(deriveMessage(w)),
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
            /spec count.*<.*demo count/.test(deriveMessage(w)),
        ),
      ).toBe(true);
    });

    it("warns with qa-under-coverage when qa count < demo count", () => {
      // Fixture: 2 demos but only 1 QA doc. Distinct from spec-less (which
      // omits a spec). Exercises the qa-under-coverage branch via a
      // direct in-process auditPackage call (no CLI subprocess).
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-qaundercov-"));
      try {
        writeFixturePackage(tmp, "qa-less", {
          manifest:
            "slug: qa-less\ndemos:\n  - id: chat\n    name: Chat\n  - id: tools\n    name: Tools\n",
          demoDirs: ["chat", "tools"],
          specFiles: ["chat.spec.ts", "tools.spec.ts"],
          qaFiles: ["chat.md"],
        });
        const report = auditPackage("qa-less", tmp);
        expect(
          report.warnings.some(
            (w) =>
              w.category === "qa-under-coverage" &&
              /qa count.*<.*demo count/.test(deriveMessage(w)),
          ),
        ).toBe(true);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("warns with missing-qa category when a demo has spec but no qa file", () => {
      // Fixture: demo has a spec but no qa — tests the per-demo
      // missing-qa branch explicitly, distinct from the bucket-wide
      // qa-under-coverage warning.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-missqa-"));
      try {
        writeFixturePackage(tmp, "no-qa", {
          manifest: "slug: no-qa\ndemos:\n  - id: chat\n    name: Chat\n",
          demoDirs: ["chat"],
          specFiles: ["chat.spec.ts"],
        });
        const report = auditPackage("no-qa", tmp);
        expect(
          report.warnings.some(
            (w) =>
              w.category === "missing-qa" &&
              w.demoId === "chat" &&
              /no qa\/chat\.md/.test(deriveMessage(w)),
          ),
        ).toBe(true);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("emits baseline-deviation warning via direct auditPackage when demo count != baseline", () => {
      // Direct in-process call (no CLI subprocess) asserting the
      // structured baseline-deviation category, complementing the
      // existing CLI-level coverage.
      const report = auditPackage("ok-pkg", FIXTURES_DIR, 5);
      expect(
        report.warnings.some(
          (w) =>
            w.category === "baseline-deviation" &&
            /demo count 1 deviates from baseline 5/.test(deriveMessage(w)),
        ),
      ).toBe(true);
    });

    it("uses structured warning category assertions instead of [WARN] prefix text", () => {
      // Replaces brittle stderr [WARN] prefix scraping. Assert on the
      // typed `warnings` array shape directly.
      const report = auditPackage("missing-spec", FIXTURES_DIR);
      const missingSpec = report.warnings.find(
        (w) => w.category === "missing-spec",
      );
      expect(missingSpec).toBeDefined();
      if (missingSpec && missingSpec.category === "missing-spec") {
        expect(missingSpec.demoId).toBe("chat");
        expect(deriveMessage(missingSpec)).toMatch(
          /no tests\/e2e\/chat\.spec\.ts/,
        );
      }
    });

    it("elevates unreadable demos dir to MUST with unreadable-demos-dir and suppresses missing-demo-dir cascade", () => {
      // When src/app/demos/ is unreadable, the legacy behaviour was to
      // report a listing-failed WARNING plus N missing-demo-dir MUST
      // errors (one per declared demo). The root cause (EACCES on demos/)
      // was buried. New contract: one MUST error of category
      // "unreadable-demos-dir", no missing-demo-dir cascade.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-demosunread-"));
      try {
        const pkgDir = path.join(tmp, "demos-unreadable");
        fs.mkdirSync(path.join(pkgDir, "src", "app", "demos"), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(pkgDir, "manifest.yaml"),
          "slug: demos-unreadable\ndemos:\n  - id: a\n  - id: b\n  - id: c\n",
          "utf-8",
        );
        const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        // Capture the real readdirSync BEFORE spyOn replaces it. Any
        // reference to `fs.readdirSync` after spyOn resolves to the spy
        // itself, so using that as the fallback would recurse forever on
        // unrelated reads.
        const origReaddir = fs.readdirSync;
        const readdirSpy = vi.spyOn(fs, "readdirSync").mockImplementation(((
          p: fs.PathLike,
          ...rest: unknown[]
        ) => {
          const s = typeof p === "string" ? p : p.toString();
          if (
            s.endsWith(`${path.sep}src${path.sep}app${path.sep}demos`) ||
            s.endsWith("/src/app/demos")
          ) {
            const e: NodeJS.ErrnoException = Object.assign(
              new Error("EACCES: permission denied"),
              { code: "EACCES" },
            );
            throw e;
          }
          return (
            origReaddir as unknown as (
              p: fs.PathLike,
              ...rest: unknown[]
            ) => unknown
          ).call(fs, p, ...rest);
        }) as unknown as typeof fs.readdirSync);
        try {
          const report = auditPackage("demos-unreadable", tmp);
          // MUST contains exactly one unreadable-demos-dir, no per-demo cascade.
          const unreadable = report.mustErrors.filter(
            (e) => e.category === "unreadable-demos-dir",
          );
          expect(unreadable.length).toBe(1);
          const missingDemoDir = report.mustErrors.filter(
            (e) => e.category === "missing-demo-dir",
          );
          expect(missingDemoDir.length).toBe(0);
          // And the warnings array must NOT still carry the listing-failed
          // entry for demos dir (it was elevated, not duplicated).
          const listingFailedDemos = report.warnings.filter(
            (w) =>
              w.category === "listing-failed" && /src\/app\/demos/.test(w.path),
          );
          expect(listingFailedDemos.length).toBe(0);
        } finally {
          readdirSpy.mockRestore();
          warnSpy.mockRestore();
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("still lists spec/qa files after a manifest failure so reporter counts are accurate", () => {
      // When manifest is malformed, MUST error still fires, but the
      // reporter row benefits from knowing spec/qa counts. Early return
      // was hiding those counts. New contract: specFiles / qaFiles
      // populated with whatever is on disk.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-manfail-"));
      try {
        const pkgDir = path.join(tmp, "manifest-bad");
        fs.mkdirSync(pkgDir, { recursive: true });
        // Malformed manifest.
        fs.writeFileSync(
          path.join(pkgDir, "manifest.yaml"),
          "slug: manifest-bad\ndemos:\n  - id: a\n  invalid: [unclosed\n",
          "utf-8",
        );
        // But qa + spec files exist.
        fs.mkdirSync(path.join(pkgDir, "tests", "e2e"), { recursive: true });
        fs.writeFileSync(
          path.join(pkgDir, "tests", "e2e", "a.spec.ts"),
          "",
          "utf-8",
        );
        fs.mkdirSync(path.join(pkgDir, "qa"), { recursive: true });
        fs.writeFileSync(path.join(pkgDir, "qa", "a.md"), "", "utf-8");
        const report = auditPackage("manifest-bad", tmp);
        // MUST still gate the exit code.
        expect(
          report.mustErrors.some((e) => e.category === "malformed-manifest"),
        ).toBe(true);
        // specFiles / qaFiles populated from disk, not empty.
        expect(report.specFiles).toEqual(["a.spec.ts"]);
        expect(report.qaFiles).toEqual(["a.md"]);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("auditPackage throws when baselineDemoCount is not a positive integer", () => {
      // Defense-in-depth: callers outside runParity() can invoke
      // auditPackage directly. Bad baseline values should fail fast, not
      // silently warn or NaN-compare.
      for (const bad of [0, -1, 1.5, NaN, Infinity, -Infinity]) {
        expect(() => auditPackage("ok-pkg", FIXTURES_DIR, bad)).toThrow(
          /baselineDemoCount/,
        );
      }
    });

    it("re-throws unknown (non-manifest) errors from loadManifest instead of mislabelling them as malformed-manifest", () => {
      // If loadManifest throws an error that is NOT a
      // ManifestMalformedError / ManifestUnreadableError — e.g. a
      // TypeError surfaced from a bug — auditPackage must NOT silently
      // bucket it as `malformed-manifest` (which would hide the real
      // defect). The catch-all branch should re-throw so the top-level
      // CLI handler surfaces an [INTERNAL ERROR] with EXIT_INTERNAL.
      //
      // We force loadManifest to throw a TypeError by monkey-patching
      // fs.readFileSync (which parseManifest calls through
      // loadManifest) to throw. parseManifest itself catches readFileSync
      // failures and converts to { kind: "unreadable" }, so we instead
      // patch fs.readdirSync? — no: loadManifest doesn't call that.
      // Instead: patch Object.freeze to throw (parseManifest uses it
      // late, after validation, to seal the result). A TypeError from
      // Object.freeze is NOT a ManifestMalformed/Unreadable error, so
      // loadManifest's own switch will not rewrap it — it will propagate
      // up to auditPackage where the catch-all else lives.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-unknown-err-"));
      try {
        const pkgDir = path.join(tmp, "ok-pkg");
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(
          path.join(pkgDir, "manifest.yaml"),
          "slug: ok-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
          "utf-8",
        );
        const originalFreeze = Object.freeze;
        const sentinel = new TypeError("synthetic non-manifest failure");
        try {
          Object.freeze = ((o: unknown) => {
            // Only throw once parseManifest is actually freezing demo
            // objects (they have a stringy id). Leaves other freeze
            // calls in the test harness untouched.
            if (
              o !== null &&
              typeof o === "object" &&
              "id" in (o as Record<string, unknown>)
            ) {
              throw sentinel;
            }
            return originalFreeze(o as object);
          }) as typeof Object.freeze;
          expect(() => auditPackage("ok-pkg", tmp)).toThrow(sentinel);
        } finally {
          Object.freeze = originalFreeze;
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("rejects manifests whose inner slug disagrees with the directory slug (slug-mismatch guard wired via loadManifest)", () => {
      // parseManifest accepts an optional dirSlug and returns
      // a shape-malformed result when `slug:` in the YAML differs from
      // the directory name on disk. loadManifest (and by extension
      // auditPackage) must wire that guard in — otherwise a copy-paste
      // or rename mistake silently keys into the wrong package.
      const tmp = fs.mkdtempSync(
        path.join(os.tmpdir(), "parity-slugmismatch-"),
      );
      try {
        const pkgDir = path.join(tmp, "actual-slug");
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(
          path.join(pkgDir, "manifest.yaml"),
          "slug: declared-slug\ndemos: []\n",
          "utf-8",
        );
        const report = auditPackage("actual-slug", tmp);
        expect(
          report.mustErrors.some(
            (e) =>
              e.category === "malformed-manifest" &&
              /slug mismatch/.test(deriveMessage(e)),
          ),
          JSON.stringify(report.mustErrors),
        ).toBe(true);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
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
        expect(deriveMessage(result.warnings[0])).toMatch(
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
        expect(deriveMessage(result.warnings[0])).toMatch(
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
      "rejects invalid VALIDATE_PARITY_BASELINE=%j with exit 2 (EXIT_INVALID_INPUT)",
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
        // Invalid CLI input should be distinguishable from a legitimate
        // MUST failure (exit 1). audit.ts uses exit 2 for the same
        // category of error — keep the taxonomy aligned across tools.
        expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(2);
        expect(r.stderr).toMatch(/VALIDATE_PARITY_BASELINE/);
      },
    );

    it("rejects invalid --baseline=abc with exit 2 (EXIT_INVALID_INPUT)", () => {
      writeFixturePackage(tree.packagesDir, "only-pkg", {
        manifest: "slug: only-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
        demoDirs: ["chat"],
        specFiles: ["chat.spec.ts"],
        qaFiles: ["chat.md"],
      });
      const r = runCli(["--baseline=abc"], {
        env: { VALIDATE_PARITY_REPO_ROOT: tree.root },
      });
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(2);
      expect(r.stderr).toMatch(/invalid --baseline value/);
    });
  });

  describe("coerceBaseline (discriminated union)", () => {
    // coerceBaseline returns { ok: true, value } | { ok: false, reason }
    // so the caller can surface a specific diagnostic (hex vs float vs
    // negative etc.) instead of one blanket "invalid" message.
    it("returns ok:true for valid positive integers", () => {
      expect(coerceBaseline(9)).toEqual({ ok: true, value: 9 });
      expect(coerceBaseline("9")).toEqual({ ok: true, value: 9 });
      expect(coerceBaseline("42")).toEqual({ ok: true, value: 42 });
    });

    it("rejects empty / whitespace with reason", () => {
      expect(coerceBaseline("")).toEqual({ ok: false, reason: "empty" });
      expect(coerceBaseline("   ")).toEqual({
        ok: false,
        reason: "whitespace",
      });
    });

    it("rejects zero with reason", () => {
      expect(coerceBaseline(0)).toEqual({ ok: false, reason: "zero" });
      expect(coerceBaseline("0")).toEqual({ ok: false, reason: "zero" });
    });

    it("rejects negatives with reason", () => {
      expect(coerceBaseline(-1)).toEqual({ ok: false, reason: "negative" });
      expect(coerceBaseline("-1")).toEqual({ ok: false, reason: "negative" });
    });

    it("rejects floats with reason", () => {
      expect(coerceBaseline(1.5)).toEqual({ ok: false, reason: "float" });
      expect(coerceBaseline("1.5")).toEqual({ ok: false, reason: "float" });
    });

    it("rejects hex notation with reason", () => {
      expect(coerceBaseline("0x10")).toEqual({ ok: false, reason: "hex" });
    });

    it("rejects non-numeric strings with reason", () => {
      expect(coerceBaseline("abc")).toEqual({
        ok: false,
        reason: "non-numeric",
      });
      expect(coerceBaseline("NaN")).toEqual({
        ok: false,
        reason: "non-numeric",
      });
      expect(coerceBaseline("1e2")).toEqual({
        ok: false,
        reason: "non-numeric",
      });
    });

    it("rejects NaN / Infinity (numeric) with reason", () => {
      expect(coerceBaseline(NaN)).toEqual({
        ok: false,
        reason: "non-numeric",
      });
      expect(coerceBaseline(Infinity)).toEqual({
        ok: false,
        reason: "non-numeric",
      });
    });

    it("includes the specific reason in CLI error output", () => {
      // The CLI diagnostic should thread the reason through to the
      // user-facing message so bad input is actionable, not opaque.
      const { root, packagesDir } = makeMainTree();
      try {
        writeFixturePackage(packagesDir, "only-pkg", {
          manifest: "slug: only-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
          demoDirs: ["chat"],
          specFiles: ["chat.spec.ts"],
          qaFiles: ["chat.md"],
        });
        const r = spawnSync("npx", ["tsx", PARITY_SCRIPT, "--baseline=1.5"], {
          env: { ...process.env, VALIDATE_PARITY_REPO_ROOT: root },
          encoding: "utf-8",
          timeout: 30_000,
        });
        // Invalid input → exit 2 (EXIT_INVALID_INPUT), not 1 (MUST failure).
        expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(2);
        expect(r.stderr).toMatch(/float/i);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe("table formatting column widths", () => {
    // Header and data rows must use the SAME column widths. Previously
    // HEADER_COLUMNS declared status=6, demos=5, specs=5, qa=3 while
    // rows hardcoded padStart(4)/padStart(4)/padStart(3) — producing
    // misaligned output. Both must now be driven from a single source
    // (HEADER_COLUMNS).
    it("HEADER_COLUMNS is the single source of truth", () => {
      expect(Array.isArray(HEADER_COLUMNS)).toBe(true);
      expect(HEADER_COLUMNS.length).toBeGreaterThan(0);
    });

    it("formatRow output length matches buildHeader output length", () => {
      // The cell separator is "  " (two spaces), but right-aligned cells
      // can themselves begin with spaces, so splitting on "  " can over-
      // segment. Instead, assert the overall rendered lengths match —
      // they can only match if EVERY column width matches char-for-char,
      // because padCell enforces equal widths per cell and the separator
      // count is identical on both sides.
      const slugWidth = 10;
      const header = buildHeader(slugWidth);
      const row = formatRow(
        {
          slug: "short",
          demoIds: ["a"],
          specFiles: ["a.spec.ts"],
          qaFiles: ["a.md"],
          demoDirs: ["a"],
          mustErrors: [],
          warnings: [],
        },
        slugWidth,
      );
      expect(row.length).toBe(header.length);
    });

    it("formatRow widths are driven from HEADER_COLUMNS so header and rows can't drift", () => {
      // Render a row with minimal content for each non-slug column and
      // verify the rendered cell at position i is EXACTLY the declared
      // width (or the slug width at index 0). This locks the contract
      // without depending on how cells are joined into a line.
      const slugWidth = 12;
      const report = {
        slug: "p".padEnd(slugWidth, "p"),
        demoIds: ["a"],
        specFiles: ["a.spec.ts"],
        qaFiles: ["a.md"],
        demoDirs: ["a"],
        mustErrors: [],
        warnings: [],
      };
      const row = formatRow(report, slugWidth);
      const header = buildHeader(slugWidth);
      // Sum of column widths + separators is identical on both sides.
      const expectedLen =
        slugWidth +
        HEADER_COLUMNS.slice(1).reduce((acc, c) => acc + c.width, 0) +
        // "  " separator between N columns → (N-1) * 2
        (HEADER_COLUMNS.length - 1) * 2;
      expect(row.length).toBe(expectedLen);
      expect(header.length).toBe(expectedLen);
    });
  });

  describe("main() uses process.exitCode (stdout drain safety)", () => {
    // validate-parity.ts's CLI entrypoint must NOT call process.exit(code)
    // synchronously — doing so truncates the buffered pass/summary stdout
    // table that runParity just wrote. audit.ts and validate-pins.ts both
    // use `process.exitCode = N; return;` so stdout drains before the
    // process is torn down. Pin that contract with a subprocess test that
    // checks the full table is actually received on stdout.
    let tree: { root: string; packagesDir: string };

    beforeEach(() => {
      tree = makeMainTree();
    });

    afterEach(() => {
      fs.rmSync(tree.root, { recursive: true, force: true });
    });

    it("emits the full summary table on stdout even when exiting non-zero", () => {
      // Two packages: one PASS, one FAIL. The summary line is the last
      // thing runParity logs; if main() calls process.exit synchronously
      // the FAIL row may still make it out but the summary can be
      // truncated. We assert the summary line is present on stdout.
      writeFixturePackage(tree.packagesDir, "ok-pkg", {
        manifest: "slug: ok-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
        demoDirs: ["chat"],
        specFiles: ["chat.spec.ts"],
        qaFiles: ["chat.md"],
      });
      writeFixturePackage(tree.packagesDir, "bad-pkg", {
        manifest: "slug: bad-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
        // no demoDirs → MUST failure
      });
      const r = spawnSync("npx", ["tsx", PARITY_SCRIPT], {
        env: { ...process.env, VALIDATE_PARITY_REPO_ROOT: tree.root },
        encoding: "utf-8",
        timeout: 30_000,
      });
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(1);
      // Summary line is the last thing written to stdout — if exit
      // truncated stdout it would be missing.
      expect(r.stdout).toMatch(/2 package\(s\) checked/);
      expect(r.stdout).toMatch(/ok-pkg/);
      expect(r.stdout).toMatch(/bad-pkg/);
    });

    it("[source-lint] main() body uses process.exitCode, not synchronous process.exit(code)", () => {
      // This is a source-level lint (not a behavioural test): the
      // convention shared with audit.ts / validate-pins.ts is
      // `process.exitCode = N` so Node can drain buffered stdout/stderr
      // before tearing down. The companion behavioural assertion lives
      // in the "emits the full summary table on stdout even when
      // exiting non-zero" test above, which confirms the drain actually
      // works end-to-end. This lint guards against a regression where
      // someone swaps main()'s body back to synchronous process.exit.
      const src = fs.readFileSync(PARITY_SCRIPT, "utf-8");
      const mainMatch = src.match(
        /function main\([^)]*\)[^{]*\{([\s\S]*?)\n\}/,
      );
      expect(mainMatch).not.toBeNull();
      const mainBody = mainMatch![1];
      expect(mainBody).not.toMatch(/process\.exit\(/);
      expect(mainBody).toMatch(/process\.exitCode/);
    });
  });

  describe("listFiles guards against bare suffix filenames", () => {
    // `d.name.endsWith(suffix)` alone would accept a file literally named
    // ".spec.ts" (stem = "") or ".md" as a valid entry, producing a
    // downstream demoId="" in auditPackage's specIdSet / qaIdSet. Guard
    // with a stem non-empty check so malformed entries are quietly
    // ignored instead of matching no declared demo.
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-bare-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("skips a file literally named '.spec.ts' (empty stem)", () => {
      fs.writeFileSync(path.join(tmpDir, ".spec.ts"), "", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "chat.spec.ts"), "", "utf-8");
      const result = listFiles(tmpDir, ".spec.ts");
      expect(result.entries).toEqual(["chat.spec.ts"]);
    });

    it("skips a file literally named '.md' (empty stem)", () => {
      fs.writeFileSync(path.join(tmpDir, ".md"), "", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "chat.md"), "", "utf-8");
      const result = listFiles(tmpDir, ".md");
      expect(result.entries).toEqual(["chat.md"]);
    });

    it("keeps dotfiles with a stem after the leading dot (e.g. '.hidden.md')", () => {
      // Only the exact bare-suffix case is filtered. A dotfile with a
      // real stem after the first dot still matches — this guard is
      // narrow by design.
      fs.writeFileSync(path.join(tmpDir, ".hidden.md"), "", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "chat.md"), "", "utf-8");
      const result = listFiles(tmpDir, ".md");
      expect(result.entries).toEqual([".hidden.md", "chat.md"]);
    });
  });

  describe("deriveMessage renders PackageIssue at display time", () => {
    // PackageIssue entries no longer pre-format a `message` field that
    // duplicates the structured category/demoId/path. Callers render
    // messages on demand via deriveMessage(), keeping structured data
    // as the single source of truth.
    it("renders missing-manifest without any extra fields", () => {
      expect(deriveMessage({ category: "missing-manifest" })).toBe(
        "missing manifest.yaml",
      );
    });

    it("renders malformed-manifest including the parser error text", () => {
      expect(
        deriveMessage({
          category: "malformed-manifest",
          error: "YAML parse failed at line 3",
        }),
      ).toBe("unparseable manifest.yaml: YAML parse failed at line 3");
    });

    it("renders unreadable-manifest including the OS error text", () => {
      expect(
        deriveMessage({
          category: "unreadable-manifest",
          error: "EACCES: permission denied",
        }),
      ).toBe("unreadable manifest.yaml: EACCES: permission denied");
    });

    it("renders missing-demo-dir including the demo id", () => {
      expect(
        deriveMessage({ category: "missing-demo-dir", demoId: "chat" }),
      ).toBe(
        "demo 'chat' declared in manifest but no src/app/demos/chat/ directory",
      );
    });

    it("renders unreadable-demos-dir including the failing path", () => {
      expect(
        deriveMessage({
          category: "unreadable-demos-dir",
          path: "/x/y/src/app/demos",
          error: "EACCES",
        }),
      ).toMatch(/unreadable demos directory/);
    });

    it("renders missing-spec including the demo id", () => {
      expect(deriveMessage({ category: "missing-spec", demoId: "tools" })).toBe(
        "demo 'tools' has no tests/e2e/tools.spec.ts",
      );
    });

    it("renders missing-qa including the demo id", () => {
      expect(deriveMessage({ category: "missing-qa", demoId: "tools" })).toBe(
        "demo 'tools' has no qa/tools.md",
      );
    });

    it("renders baseline-deviation with the counts", () => {
      expect(
        deriveMessage({
          category: "baseline-deviation",
          demoCount: 1,
          baseline: 9,
        }),
      ).toBe("demo count 1 deviates from baseline 9");
    });

    it("renders spec-under-coverage with the counts", () => {
      expect(
        deriveMessage({
          category: "spec-under-coverage",
          specCount: 1,
          demoCount: 2,
        }),
      ).toBe("spec count 1 < demo count 2");
    });

    it("renders qa-under-coverage with the counts", () => {
      expect(
        deriveMessage({
          category: "qa-under-coverage",
          qaCount: 1,
          demoCount: 2,
        }),
      ).toBe("qa count 1 < demo count 2");
    });

    it("renders listing-failed with path and error", () => {
      expect(
        deriveMessage({
          category: "listing-failed",
          path: "/x/y",
          error: "EACCES: permission denied",
        }),
      ).toBe("failed to read directory /x/y: EACCES: permission denied");
    });
  });

  describe("PackageReport issue arrays are readonly at the type level", () => {
    // Defence-in-depth against accidental in-place mutation after
    // auditPackage returns. TypeScript's `readonly T[]` surfaces any
    // push/splice/shift attempt as a compile error rather than allowing
    // callers to silently corrupt the report.
    it("mustErrors and warnings are exposed as readonly arrays", () => {
      const report = auditPackage("ok-pkg", FIXTURES_DIR);
      // Runtime inspection: freeze is not required (the type check
      // enforces the contract), but assert the arrays are actually the
      // ones built by auditPackage and not nullish.
      expect(Array.isArray(report.mustErrors)).toBe(true);
      expect(Array.isArray(report.warnings)).toBe(true);
    });
  });

  describe("runParity does not read process.argv when called programmatically", () => {
    // Regression: programmatic callers (e.g. future aggregator scripts
    // or tests) should be able to invoke runParity with an explicit
    // baseline and NOT have process.argv parsed behind their backs.
    it("ignores process.argv when baselineDemoCount is passed explicitly", () => {
      const { root, packagesDir } = makeMainTree();
      try {
        writeFixturePackage(packagesDir, "only-pkg", {
          manifest: "slug: only-pkg\ndemos:\n  - id: chat\n    name: Chat\n",
          demoDirs: ["chat"],
          specFiles: ["chat.spec.ts"],
          qaFiles: ["chat.md"],
        });
        const originalArgv = process.argv;
        // Inject a bad --baseline flag that WOULD fail argv parsing.
        process.argv = [
          process.argv[0],
          process.argv[1],
          "--baseline=not-a-number",
        ];
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          const code = runParity(packagesDir, 5);
          // If argv were parsed, we'd get exit 1 (invalid baseline).
          // With explicit baseline=5 passed, argv must be skipped.
          expect(code).toBe(0);
          // And no "invalid --baseline value" must have been logged.
          const errCalls = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
          expect(errCalls).not.toMatch(/invalid --baseline value/);
        } finally {
          logSpy.mockRestore();
          errSpy.mockRestore();
          process.argv = originalArgv;
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
