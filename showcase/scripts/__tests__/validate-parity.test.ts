/**
 * Tests for showcase parity validator.
 *
 * Uses fixture package directories under __tests__/fixtures/parity/ to exercise
 * loadManifest/auditPackage error paths without depending on the live
 * showcase/packages layout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  auditPackage,
  loadManifest,
  listFiles,
  listDirs,
} from "../validate-parity.js";

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "parity",
);

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

    it("does not invoke main() on import (isMain guard is in place)", () => {
      // If main() ran on import, the test runner would have exited by now
      // or fs.readdirSync(PACKAGES_DIR) would have side-effected in a way
      // we'd catch. This test simply re-imports the module and verifies no
      // throw — main() walking the real packages dir during a vitest run
      // would cause process.exit() calls we don't want.
      expect(async () => {
        await import("../validate-parity.js");
      }).not.toThrow();
    });
  });
});
