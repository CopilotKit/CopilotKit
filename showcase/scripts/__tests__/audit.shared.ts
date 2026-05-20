// Shared helpers for audit.*.test.ts files.
//
// audit.test.ts was originally a single ~3000-line, 119-test file that ran
// ~71s on Node 22 in CI — over the hardcoded 60s birpc `onTaskUpdate` RPC
// window (upstream vitest #6129 — `DEFAULT_TIMEOUT = 6e4` in the bundled
// birpc). With `pool: 'forks'` (see showcase/scripts/vitest.config.ts) each
// file gets its own fresh worker + its own fresh 60s RPC budget, so the
// cliff is only hit per-file — splitting by describe-category dodges it.
//
// This module hosts the tmpdir / writePackage / makeConfig fixture
// builders and the AUDIT_SCRIPT path constant so we don't duplicate them
// across the split files.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  anomalyMessage,
  type AuditConfig,
  type PackageAudit,
} from "../audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const AUDIT_SCRIPT = path.resolve(__dirname, "..", "audit.ts");

/**
 * Build a throwaway temp tree mimicking:
 *   <root>/integrations/<slug>/manifest.yaml
 *   <root>/integrations/<slug>/tests/e2e/*.spec.ts
 *   <root>/integrations/<slug>/qa/*.md
 *   <root>/examples/integrations/<name>/
 */
export function makeTmpTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-fixture-"));
  fs.mkdirSync(path.join(root, "integrations"), { recursive: true });
  fs.mkdirSync(path.join(root, "examples", "integrations"), {
    recursive: true,
  });
  return root;
}

export function makeConfig(root: string): AuditConfig {
  return {
    packagesDir: path.join(root, "integrations"),
    examplesIntegrationsDir: path.join(root, "examples", "integrations"),
    repoRoot: root,
  };
}

export function writePackage(
  root: string,
  slug: string,
  opts: {
    manifest?: string; // raw YAML string; undefined = no manifest.yaml
    specs?: string[];
    qaFiles?: string[];
  },
) {
  const pkgDir = path.join(root, "integrations", slug);
  fs.mkdirSync(pkgDir, { recursive: true });
  if (opts.manifest !== undefined) {
    fs.writeFileSync(path.join(pkgDir, "manifest.yaml"), opts.manifest);
  }
  if (opts.specs && opts.specs.length > 0) {
    const e2eDir = path.join(pkgDir, "tests", "e2e");
    fs.mkdirSync(e2eDir, { recursive: true });
    for (const s of opts.specs) {
      fs.writeFileSync(path.join(e2eDir, s), "// test\n");
    }
  }
  if (opts.qaFiles && opts.qaFiles.length > 0) {
    const qaDir = path.join(pkgDir, "qa");
    fs.mkdirSync(qaDir, { recursive: true });
    for (const q of opts.qaFiles) {
      fs.writeFileSync(path.join(qaDir, q), "# qa\n");
    }
  }
}

export function makeExampleDir(root: string, name: string) {
  fs.mkdirSync(path.join(root, "examples", "integrations", name), {
    recursive: true,
  });
}

// Helpers that recover the old string-based predicates so tests read like
// a behavioral spec even though the underlying type is now tagged.
export function anomalyStrings(a: PackageAudit): string[] {
  return a.anomalies.map(anomalyMessage);
}
