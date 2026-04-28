// Split from audit.test.ts — see audit.shared.ts header for the full
// rationale (vitest birpc 60s cliff, fork-per-file).
//
// This file hosts ALL subprocess-heavy describes: main() exit codes via
// the CLI, --columns filtering via the CLI, and the module isMain guard
// (which also spawns a subprocess). These are the tests most sensitive
// to the birpc cliff because every `it` shells out to `npx tsx` — the
// per-file fork window isolates their cost so they never stack onto the
// in-process describes' budget.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { SLUG_TO_EXAMPLES } from "../audit.js";
import {
  AUDIT_SCRIPT,
  makeTmpTree,
  writePackage,
  makeExampleDir,
} from "./audit.shared.js";

describe("main() exit codes via CLI subprocess", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpTree();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function runCli(
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  ) {
    return spawnSync("npx", ["tsx", AUDIT_SCRIPT, ...args], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      encoding: "utf-8",
      timeout: 30_000,
    });
  }

  it("exits 0 when there are no anomalies", () => {
    writePackage(root, "crewai-crews", {
      manifest: `slug: crewai-crews\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    makeExampleDir(root, "crewai-crews");
    const r = runCli([], {
      env: { SHOWCASE_AUDIT_ROOT: root },
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    // Positive stdout assertions: a regression that truncates stdout or
    // drops the summary/table would slip past a r.status-only check.
    // Pin the column headers as whole tokens, the Overall health
    // counters, and the clean-state affirmation line.
    expect(r.stdout).toMatch(/\bslug\b/);
    expect(r.stdout).toMatch(/\bdemos\b/);
    expect(r.stdout).toMatch(/\bspecs\b/);
    expect(r.stdout).toMatch(/\bdeployed\b/);
    expect(r.stdout).toMatch(/\bexamples src\b/);
    expect(r.stdout).toMatch(/Packages total:\s+1/);
    expect(r.stdout).toMatch(/Clean:\s+1/);
    expect(r.stdout).toMatch(/With anomalies:\s+0/);
    expect(r.stdout).toMatch(/All packages pass coverage audit/);
    // The fixture slug must appear as its own row in the table.
    expect(r.stdout).toMatch(/\bcrewai-crews\b/);
  });

  it("exits 1 when anomalies are found", () => {
    writePackage(root, "bad", {
      manifest: `slug: bad\ndeployed: false\ndemos:\n  - id: a\n`,
      specs: [],
      qaFiles: [],
    });
    const r = runCli([], {
      env: { SHOWCASE_AUDIT_ROOT: root },
    });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    // Positive stdout assertions: the anomaly report must include the
    // slug and at least one of the expected anomaly categories for the
    // fixture (count mismatch, not deployed, missing examples).
    expect(r.stdout).toMatch(/\bbad\b/);
    expect(r.stdout).toMatch(/Coverage anomalies/);
    expect(r.stdout).toMatch(/Packages total:\s+1/);
    expect(r.stdout).toMatch(/With anomalies:\s+1/);
  });

  it("exits 3 (unreadable) when SHOWCASE_AUDIT_ROOT points to missing packages dir", () => {
    // Missing/unreadable packages dir is infrastructure failure, not
    // user-input failure — distinct exit code from "invalid content" (2).
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "audit-empty-"));
    try {
      const r = runCli([], {
        env: { SHOWCASE_AUDIT_ROOT: empty },
      });
      expect(r.status, r.stdout + r.stderr).toBe(3);
      // Tighten from /integrations/i — that would also match log lines that
      // merely name the string "integrations". Pin the specific diagnostic
      // phrase so a regression that swallows the reason (and exits 3
      // for some other cause) can't slip through.
      expect(r.stderr).toMatch(/packages dir does not exist/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("exits 3 (unreadable) when packages path exists but is a file, not a directory", () => {
    // Regression guard: previously `readdirSync` on a file path threw
    // ENOTDIR inside the try/catch in listShowcasePackageSlugs which
    // returned [], so the CLI collapsed to "empty packages" (exit 1). We
    // now distinguish this with a dedicated stat() check — exit 3.
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "audit-file-"));
    try {
      // Create <fixture>/packages as a FILE, not a directory.
      fs.writeFileSync(path.join(fixture, "integrations"), "not a dir\n");
      const r = runCli([], {
        env: { SHOWCASE_AUDIT_ROOT: fixture },
      });
      expect(r.status, r.stdout + r.stderr).toBe(3);
      expect(r.stderr).toMatch(/not a directory/i);
      // Tighten: the diagnostic MUST NOT claim the path "does not exist"
      // — the file is present, just not a directory. The previous
      // redundant `existsSync` pre-check produced the misleading "does
      // not exist" wording for this case. After the fix, the statSync
      // block produces a precise "is not a directory" message.
      expect(r.stderr).not.toMatch(/packages dir does not exist/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("exits 3 with a precise EACCES diagnostic when packages dir stat fails (not the misleading 'does not exist' message)", () => {
    // Regression guard: main()'s redundant `fs.existsSync` pre-check
    // emitted "packages dir does not exist" for EACCES/EPERM/EIO failures
    // too — `existsSync` returns false for every statSync failure, not
    // just ENOENT. The fix removes the redundant pre-check so the
    // subsequent try/statSync block produces an accurate errno-specific
    // message.
    //
    // Inject an EACCES via a preload script that overrides fs.statSync
    // only for the target packages dir path (everything else passes
    // through to the real implementation so tsx/vitest internals keep
    // working).
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "audit-eacces-"));
    const preload = fs.mkdtempSync(path.join(os.tmpdir(), "audit-pre-"));
    const preloadScript = path.join(preload, "eacces.cjs");
    const pkgDir = path.join(fixture, "integrations");
    // Create the dir so existsSync would return true — the bug is that
    // statSync failing with EACCES should yield a distinct message. The
    // old redundant existsSync check short-circuits ENOENT only; EACCES
    // still falls through to statSync. But we also want to assert the
    // message doesn't claim "does not exist" — exercise the code path
    // by making statSync throw EACCES directly.
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      preloadScript,
      `const fs = require("fs");
const target = ${JSON.stringify(pkgDir)};
const origStat = fs.statSync;
fs.statSync = function(...args) {
  if (String(args[0]) === target) {
    const e = new Error("EACCES: permission denied, stat '" + target + "'");
    e.code = "EACCES";
    throw e;
  }
  return origStat.apply(this, args);
};
const origExists = fs.existsSync;
fs.existsSync = function(...args) {
  if (String(args[0]) === target) {
    // Simulate existsSync hiding EACCES as "false" — the bug.
    return false;
  }
  return origExists.apply(this, args);
};
`,
    );
    try {
      const r = spawnSync(
        "npx",
        ["tsx", "--require", preloadScript, AUDIT_SCRIPT],
        {
          env: { ...process.env, SHOWCASE_AUDIT_ROOT: fixture },
          encoding: "utf-8",
          timeout: 30_000,
        },
      );
      expect(r.status, r.stdout + r.stderr).toBe(3);
      // The diagnostic MUST carry the EACCES errno (precise,
      // actionable) rather than the misleading "does not exist" wording
      // the redundant existsSync branch used to emit.
      expect(r.stderr).toMatch(/EACCES/);
      expect(r.stderr).not.toMatch(/packages dir does not exist/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
      fs.rmSync(preload, { recursive: true, force: true });
    }
  });

  it("unreadable (3) and invalid-content (2) exit codes differ", () => {
    // Regression guard: these two failure modes used to share exit code
    // 2, which made it impossible for CI callers to distinguish
    // "nothing to audit" from "I don't know what you meant".
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "audit-diff-"));
    try {
      const unreadable = runCli([], {
        env: { SHOWCASE_AUDIT_ROOT: empty },
      });
      const invalidArgs = runCli(["--slug", "--json"], {
        env: { SHOWCASE_AUDIT_ROOT: empty },
      });
      expect(unreadable.status).not.toBe(invalidArgs.status);
      expect(unreadable.status).toBe(3);
      expect(invalidArgs.status).toBe(2);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("exits 1 (anomaly) when packages dir exists but is empty", () => {
    // tree already has empty packages dir from makeTmpTree
    const r = runCli([], {
      env: { SHOWCASE_AUDIT_ROOT: root },
    });
    expect(r.status, r.stdout + r.stderr).toBe(1);
  });

  it("exits 2 on invalid arg combination (bad arg: --slug --json)", () => {
    writePackage(root, "crewai-crews", {
      manifest: `slug: crewai-crews\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    makeExampleDir(root, "crewai-crews");
    const r = runCli(["--slug", "--json"], {
      env: { SHOWCASE_AUDIT_ROOT: root },
    });
    // argparse failure is a user/internal error, not a package anomaly.
    expect(r.status, r.stdout + r.stderr).toBe(2);
  });

  it("--json --slug <slug> combination emits JSON for a single package", () => {
    writePackage(root, "crewai-crews", {
      manifest: `slug: crewai-crews\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    makeExampleDir(root, "crewai-crews");
    writePackage(root, "other", {
      manifest: `slug: other\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    makeExampleDir(root, "other");
    const r = runCli(["--json", "--slug", "crewai-crews"], {
      env: { SHOWCASE_AUDIT_ROOT: root },
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.packages.length).toBe(1);
    expect(parsed.packages[0].slug).toBe("crewai-crews");
    // Scalar summary exposed alongside the nested report.
    expect(parsed.hasAnomalies).toBe(false);
    expect(parsed.exitCode).toBe(0);
  });

  it("JSON mode does not duplicate per-package warnings to stderr", () => {
    // In JSON mode, warnings are already carried on
    // `packages[i].warnings` — echoing them to stderr would
    // double-emit the same information. A consumer redirecting
    // `2>/dev/null` should still get a complete machine-readable
    // report via stdout.
    const mappedSlug = "mastra";
    expect(SLUG_TO_EXAMPLES[mappedSlug]).toBeDefined();
    writePackage(root, mappedSlug, {
      manifest: `slug: ${mappedSlug}\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    // Intentionally DO NOT create examples/integrations/<mapped> dir so
    // findExamplesSource emits a stale-mapping warning.
    const r = runCli(["--json"], {
      env: { SHOWCASE_AUDIT_ROOT: root },
    });
    // exit is 0/1 depending on anomalies — the focus here is stderr
    // contents, not exit code.
    expect(r.stderr || "").not.toMatch(/audit: warning:/);
    // The JSON stdout should still carry the warning on the package
    // record so JSON consumers aren't blind.
    const parsed = JSON.parse(r.stdout);
    const p = parsed.packages.find(
      (x: { slug: string }) => x.slug === mappedSlug,
    );
    expect(p).toBeDefined();
    expect(p.warnings.length).toBeGreaterThan(0);
  });

  it("text mode forwards per-package warnings to stderr for human readers", () => {
    // Counterpart: in text mode a terminal user watching stderr should
    // still see the stale-mapping diagnostic — the sink-based warnings
    // must be forwarded, not silently dropped.
    const mappedSlug = "mastra";
    expect(SLUG_TO_EXAMPLES[mappedSlug]).toBeDefined();
    writePackage(root, mappedSlug, {
      manifest: `slug: ${mappedSlug}\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    const r = runCli([], {
      env: { SHOWCASE_AUDIT_ROOT: root },
    });
    // Tighten from bare /audit: warning:/ — that would also accept any
    // unrelated warning. Pin:
    //   - the "audit: warning:" prefix (routing)
    //   - the specific slug ("mastra") that triggered it
    //   - the SLUG_TO_EXAMPLES phrase that identifies this as the
    //     stale-mapping diagnostic, not some other warning
    expect(r.stderr).toMatch(/audit: warning:/);
    expect(r.stderr).toMatch(
      new RegExp(`audit: warning: SLUG_TO_EXAMPLES entry "${mappedSlug}"`),
    );
    expect(r.stderr).toMatch(/has no matching directory/);
  });

  it("exits 4 (internal error) on unexpected exceptions", () => {
    // Inject a TypeError into the YAML parser — auditPackage delegates
    // to parseManifest which calls yaml.parse inside a try/catch that
    // maps to a `malformed` result. HOWEVER, if we monkey-patch
    // `yaml.parse` to throw a TypeError AFTER parseManifest has already
    // read the file, the catch block inside parseManifest catches that
    // and returns `malformed`. The cleanest way to trigger EXIT_INTERNAL
    // is to throw a non-Error value from a point that is NOT wrapped
    // upstream.
    //
    // Concretely: override `fs.readFileSync` to throw a TypeError ONLY
    // for the target manifest.yaml path. readFileSync in parseManifest
    // IS wrapped — but the catch returns `{kind: "unreadable", error}`
    // only if `e instanceof Error`. A TypeError IS an Error, so that
    // catch activates. That means we can't trigger EXIT_INTERNAL via
    // readFileSync either.
    //
    // The actual unwrapped paths are: buildReport's Object.freeze calls,
    // anomaly bucket operations, renderTable, renderAnomalySection,
    // renderHealthSection, JSON.stringify. The simplest wedge is to
    // monkey-patch `JSON.stringify` to throw TypeError when called with
    // the audit report, which happens only in --json mode. For the
    // default (text) mode, inject a TypeError through renderTable by
    // monkey-patching `String.prototype.padEnd` — but that's too
    // invasive.
    //
    // Simpler: force the failure in `Object.freeze` via a Proxy wrapper
    // around the anomaly array. Actually, the cleanest wedge: override
    // `Array.prototype.filter` in the preload so the FIRST call after
    // slug listing throws. But that breaks tsx too.
    //
    // Practical solution: use `--json` mode and intercept
    // `JSON.stringify` to throw once, after the report is built.
    const preload = fs.mkdtempSync(path.join(os.tmpdir(), "audit-preload-"));
    const preloadScript = path.join(preload, "boom.cjs");
    fs.writeFileSync(
      preloadScript,
      `const origStringify = JSON.stringify;
JSON.stringify = function(value, ...rest) {
  // Only fire when serializing the audit report (has the 'packages'
  // array + 'anomalies' object shape). Other JSON.stringify callers
  // (test runner, tsx internals, error formatting) still work.
  if (
    value &&
    typeof value === "object" &&
    Array.isArray(value.packages) &&
    value.anomalies &&
    typeof value.anomalies === "object" &&
    "countMismatches" in value.anomalies
  ) {
    throw new TypeError("simulated bug: should never happen");
  }
  return origStringify.call(this, value, ...rest);
};
`,
    );
    writePackage(root, "foo", {
      manifest: `slug: foo\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    try {
      const r = spawnSync(
        "npx",
        ["tsx", "--require", preloadScript, AUDIT_SCRIPT, "--json"],
        {
          env: { ...process.env, SHOWCASE_AUDIT_ROOT: root },
          encoding: "utf-8",
          timeout: 30_000,
        },
      );
      // The injected failure fires from JSON.stringify in main()'s
      // --json branch, which is NOT wrapped in a local try/catch — it
      // bubbles to the top-level catch, which must route programmer
      // bugs (TypeError) to EXIT_INTERNAL (4).
      expect(r.status, r.stdout + r.stderr).toBe(4);
      // stderr should use the programmer-bug wording, not the generic
      // "internal error" one.
      expect(r.stderr).toMatch(/bug \(programmer error\)/);
    } finally {
      fs.rmSync(preload, { recursive: true, force: true });
    }
  });

  it("exits 3 with a clear error when SHOWCASE_AUDIT_ROOT points to a nonexistent path", () => {
    // Regression guard: previously an invalid SHOWCASE_AUDIT_ROOT was
    // accepted silently and users got a confusing downstream error about
    // the derived `<root>/packages` path. We now validate the env-var
    // path itself and emit a clear message naming SHOWCASE_AUDIT_ROOT.
    const missing = path.join(
      os.tmpdir(),
      `audit-nonexistent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    // Paranoia: ensure it really doesn't exist (collision with a prior
    // run would mask the fix).
    expect(fs.existsSync(missing)).toBe(false);
    const r = runCli([], {
      env: { SHOWCASE_AUDIT_ROOT: missing },
    });
    expect(r.status, r.stdout + r.stderr).toBe(3);
    expect(r.stderr).toMatch(/SHOWCASE_AUDIT_ROOT/);
    expect(r.stderr).toMatch(/does not exist/i);
    expect(r.stderr).toContain(missing);
  });

  it("exits 3 with a clear error when SHOWCASE_AUDIT_ROOT points to a file, not a directory", () => {
    // Counterpart regression guard: a file-typed SHOWCASE_AUDIT_ROOT used
    // to flow through to the packages-dir check and emit an unhelpful
    // "packages dir does not exist: <file>/packages" message. Now the
    // env-var validation layer catches it first with a precise diagnostic.
    const filePath = path.join(
      os.tmpdir(),
      `audit-root-as-file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.writeFileSync(filePath, "not a dir\n");
    try {
      const r = runCli([], {
        env: { SHOWCASE_AUDIT_ROOT: filePath },
      });
      expect(r.status, r.stdout + r.stderr).toBe(3);
      expect(r.stderr).toMatch(/SHOWCASE_AUDIT_ROOT/);
      expect(r.stderr).toMatch(/not a directory/i);
      expect(r.stderr).toContain(filePath);
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });
});
describe("main() --columns via CLI subprocess", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpTree();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function runCli(
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  ) {
    return spawnSync("npx", ["tsx", AUDIT_SCRIPT, ...args], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      encoding: "utf-8",
      timeout: 30_000,
    });
  }

  it("--columns filters the table to the specified columns", () => {
    writePackage(root, "crewai-crews", {
      manifest: `slug: crewai-crews\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    makeExampleDir(root, "crewai-crews");
    const r = runCli(["--columns=slug,demos"], {
      env: { SHOWCASE_AUDIT_ROOT: root },
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    // Full columns include "deployed" and "examples src"; filtered
    // output must NOT include those labels. Column headers checked
    // as whole tokens — "slug" naked matches any line with the word
    // (e.g. "crewai-crews" row) so pin a header-context regex.
    expect(r.stdout).toMatch(/\bslug\b/);
    expect(r.stdout).toMatch(/\bdemos\b/);
    expect(r.stdout).not.toMatch(/\bdeployed\b/);
    expect(r.stdout).not.toContain("examples src");
    // The fixture slug must appear as its own data row.
    expect(r.stdout).toMatch(/\bcrewai-crews\b/);
    // And the Overall health summary must still render even with a
    // filtered table.
    expect(r.stdout).toMatch(/Packages total:\s+1/);
  });
});
describe("module isMain guard", () => {
  it("does not execute main() when imported as a subprocess (proof via spawnSync)", () => {
    // Replace the tautological in-process assertion with a real
    // subprocess test. We invoke node on a tiny inline script that
    // imports audit.js (as a URL, since the real file is audit.ts and
    // emits as audit.js in the module graph) and verifies it exits 0.
    // If main() ran on import, it would exit 1 (empty packages) or 3
    // (missing packages), not 0.
    const helper = fs.mkdtempSync(path.join(os.tmpdir(), "audit-import-"));
    const helperScript = path.join(helper, "probe.mjs");
    // Use tsx to import the .ts file directly — tsx resolves the .js
    // extension against the source .ts.
    fs.writeFileSync(
      helperScript,
      `import("${AUDIT_SCRIPT.replace(/\\/g, "/")}").then((m) => {
  if (typeof m.auditPackage !== "function") process.exit(1);
  if (typeof m.buildReport !== "function") process.exit(1);
  process.exit(0);
}).catch((e) => {
  console.error(e);
  process.exit(2);
});
`,
    );
    try {
      const r = spawnSync("npx", ["tsx", helperScript], {
        encoding: "utf-8",
        timeout: 30_000,
      });
      expect(r.status, r.stdout + r.stderr).toBe(0);
    } finally {
      fs.rmSync(helper, { recursive: true, force: true });
    }
  });
});
