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
import {
  auditPackage,
  loadManifest,
  listFiles,
  listDirs,
} from "../validate-parity.js";

// Shared tmpdir populated by beforeAll with all the "static" fixture
// packages (ok-pkg, missing-manifest, missing-demo-dir, missing-spec,
// spec-exceeds, spec-less). Malformed / empty / scalar fixtures are still
// built in per-test tmpdirs because they exercise distinct crash paths.
let FIXTURES_DIR: string;

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

  // spec-exceeds: spec count > demo count (e.g. renderer-selector.spec.ts)
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

beforeAll(() => {
  FIXTURES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "parity-fixtures-"));
  seedStaticFixtures(FIXTURES_DIR);
});

afterAll(() => {
  if (FIXTURES_DIR) {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
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
        expect(() => loadManifest("malformed", tmp)).toThrow();
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
      // E.g. renderer-selector.spec.ts for langgraph-python is allowed.
      const report = auditPackage("spec-exceeds", FIXTURES_DIR);
      expect(
        report.warnings.some((w) => /spec count.*demo count/.test(w)),
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
      // Restore permissions so cleanup succeeds, then rm.
      try {
        fs.chmodSync(tmpDir, 0o755);
      } catch {
        /* ignore */
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("listDirs returns [] for a non-existent path without throwing", () => {
      expect(listDirs(path.join(tmpDir, "does-not-exist"))).toEqual([]);
    });

    it("listFiles returns [] for a non-existent path without throwing", () => {
      expect(listFiles(path.join(tmpDir, "does-not-exist"), ".md")).toEqual([]);
    });

    it("listDirs returns [] and logs a warning on readdir failure", () => {
      // Skip on Windows or when running as root — chmod 0 won't produce
      // EACCES for root.
      if (process.platform === "win32" || process.getuid?.() === 0) {
        return;
      }
      const blocked = path.join(tmpDir, "blocked");
      fs.mkdirSync(blocked);
      fs.chmodSync(blocked, 0o000);

      const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = listDirs(blocked);
        expect(result).toEqual([]);
        // Pin the "logs a warning" half of the contract — without this the
        // test would pass even if listDirs silently swallowed the error.
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/\[WARN\] failed to read directory .*blocked/),
        );
      } finally {
        fs.chmodSync(blocked, 0o755);
        warnSpy.mockRestore();
      }
    });

    it("listFiles returns [] and logs a warning on readdir failure", () => {
      // Symmetric coverage with listDirs — the same readdir failure path
      // exists in listFiles and must also be asserted.
      if (process.platform === "win32" || process.getuid?.() === 0) {
        return;
      }
      const blocked = path.join(tmpDir, "blocked-files");
      fs.mkdirSync(blocked);
      fs.chmodSync(blocked, 0o000);

      const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = listFiles(blocked, ".md");
        expect(result).toEqual([]);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(
            /\[WARN\] failed to read directory .*blocked-files/,
          ),
        );
      } finally {
        fs.chmodSync(blocked, 0o755);
        warnSpy.mockRestore();
      }
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
});
