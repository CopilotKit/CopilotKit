// create-integration.test.ts — exercises the real generator end-to-end, then
// restores every file it mutates so the working tree is byte-identical to
// `git HEAD` when the suite exits.
//
// The generator mutates:
//   - showcase/packages/test-integration-tmp/** (the scaffolded package)
//   - .github/workflows/showcase_deploy.yml           (+47 lines per run)
//   - .github/workflows/showcase_drift-detection.yml  (CI matrix row)
//   - .github/workflows/starter-smoke.yml             (+1 line per run)
//
// This file depends on vitest's `fileParallelism: false` config (see
// vitest.config.ts). The module-level `workflowRestorer` assumes no sibling
// suite is concurrently writing to the same files.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import yaml from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  FileSnapshotRestorer,
  execOptsFor,
  restoreFromGitHead,
} from "./test-cleanup";
import { SCRIPTS_DIR, REPO_ROOT, WORKFLOWS_DIR } from "./paths";

const PACKAGES_DIR = path.resolve(SCRIPTS_DIR, "..", "packages");
const SCHEMA_PATH = path.resolve(
  SCRIPTS_DIR,
  "..",
  "shared",
  "manifest.schema.json",
);
const FEATURE_REGISTRY_PATH = path.resolve(
  SCRIPTS_DIR,
  "..",
  "shared",
  "feature-registry.json",
);

const TEST_SLUG = "test-integration-tmp";
// Regression test uses its own slug so the generator always has fresh work to
// do; the primary slug is already consumed by earlier tests in the file.
const REGRESSION_SLUG = "test-integration-tmp-regression-guard";
const TEST_SLUGS: readonly string[] = [TEST_SLUG, REGRESSION_SLUG];
const TEST_DIR = path.join(PACKAGES_DIR, TEST_SLUG);
const REGRESSION_DIR = path.join(PACKAGES_DIR, REGRESSION_SLUG);

// Exactly the three workflow YAMLs the generator mutates. We deliberately do
// NOT scan `.github/workflows/` — a wider scope would (a) make restoreFromGitHead
// block a developer with uncommitted edits to ANY unrelated workflow from
// running these tests, and (b) increase the chance of unrelated workflow
// mutations being misattributed to this suite.
const WORKFLOW_FILES: readonly string[] = [
  path.join(WORKFLOWS_DIR, "showcase_deploy.yml"),
  path.join(WORKFLOWS_DIR, "showcase_drift-detection.yml"),
  path.join(WORKFLOWS_DIR, "starter-smoke.yml"),
];

// Shared restorer populated in beforeAll and drained by cleanup().
const workflowRestorer = new FileSnapshotRestorer(WORKFLOW_FILES);

function cleanup() {
  // Workflow restoration runs in a finally so a failed package-dir rmSync
  // (EBUSY on Windows, EACCES on a stuck filehandle, …) can't leak workflow
  // drift into the next test.
  try {
    for (const slug of TEST_SLUGS) {
      const dir = path.join(PACKAGES_DIR, slug);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally {
    workflowRestorer.restore();
  }
}

// beforeAll: (1) restore workflows from git so we snapshot a clean baseline
// even if a previous run crashed between mutation and afterEach, (2) snapshot,
// (3) remove any stale TEST_DIR / REGRESSION_DIR. Ordering matters — without
// the git restore a crashed run would seed our snapshot with drifted content
// and restore() would lock in the drift.
beforeAll(() => {
  restoreFromGitHead(REPO_ROOT, WORKFLOW_FILES);
  workflowRestorer.snapshot();
  if (workflowRestorer.snapshotMap.size === 0) {
    throw new Error(
      `create-integration.test.ts: workflow snapshot is empty. Expected to` +
        ` find tracked files at:\n` +
        WORKFLOW_FILES.map((p) => `  ${p}`).join("\n"),
    );
  }
  for (const slug of TEST_SLUGS) {
    const dir = path.join(PACKAGES_DIR, slug);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// `afterEach` + `afterAll` + per-test `cleanup()` at the top of each `it()` is
// deliberate: `afterEach` is the primary failsafe, `afterAll` handles the last
// test, and the top-of-body call makes each test independently re-entrant
// (rerunning a single test in isolation starts from a known-clean state).
afterEach(cleanup);
afterAll(cleanup);

// Shared exec options (from test-cleanup.ts) plus cwd. See SAFE_EXEC_OPTS
// docstring for the Node-20 stderr-race rationale.
const EXEC_OPTS = execOptsFor(SCRIPTS_DIR);

/** Invoke `npx tsx create-integration/index.ts` with argv-style args so none
 *  of the slug / feature strings ever hit a shell parser. Previous revisions
 *  used `execSync(string)` with interpolated slugs — safe today because the
 *  slugs are constants, but a poor hygiene pattern worth stamping out. */
function runGenerator(args: readonly string[]): { stdout: string } {
  const stdout = execFileSync(
    "npx",
    ["tsx", "create-integration/index.ts", ...args],
    EXEC_OPTS,
  );
  return { stdout: stdout.toString() };
}

describe("Template Generator", () => {
  it("generates a valid package structure", () => {
    cleanup();

    runGenerator([
      "--name",
      "Test Integration",
      "--slug",
      TEST_SLUG,
      "--category",
      "agent-framework",
      "--language",
      "python",
      "--features",
      "agentic-chat,hitl-in-chat",
    ]);

    // Check directory exists
    expect(fs.existsSync(TEST_DIR)).toBe(true);

    // Check required files
    const requiredFiles = [
      "manifest.yaml",
      "package.json",
      "Dockerfile",
      "entrypoint.sh",
      ".env.example",
      ".gitignore",
      "next.config.ts",
      "tsconfig.json",
      "playwright.config.ts",
      "requirements.txt",
      "src/agent_server.py",
      "src/app/layout.tsx",
      "src/app/globals.css",
      "src/app/page.tsx",
      "src/app/api/copilotkit/route.ts",
      "src/app/api/health/route.ts",
    ];

    for (const file of requiredFiles) {
      expect(fs.existsSync(path.join(TEST_DIR, file))).toBe(true);
    }
  });

  it("generates a manifest that passes schema validation", () => {
    cleanup();

    runGenerator([
      "--name",
      "Test Integration",
      "--slug",
      TEST_SLUG,
      "--category",
      "provider-sdk",
      "--language",
      "typescript",
      "--features",
      "agentic-chat,tool-rendering,mcp-apps",
    ]);

    const manifest = yaml.parse(
      fs.readFileSync(path.join(TEST_DIR, "manifest.yaml"), "utf-8"),
    );

    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const valid = validate(manifest);

    if (!valid) {
      console.error("Validation errors:", validate.errors);
    }
    expect(valid).toBe(true);

    // New fields should be present with defaults
    expect(manifest.generative_ui).toEqual(["constrained-explicit"]);
    expect(manifest.interaction_modalities).toEqual(["chat"]);
  });

  it("generates correct demo stubs for each feature", () => {
    cleanup();

    runGenerator([
      "--name",
      "Test Integration",
      "--slug",
      TEST_SLUG,
      "--category",
      "agent-framework",
      "--language",
      "python",
      "--features",
      "agentic-chat,hitl-in-chat,subagents",
    ]);

    const demoIds = ["agentic-chat", "hitl-in-chat", "subagents"];

    for (const demoId of demoIds) {
      const demoDir = path.join(TEST_DIR, "src", "app", "demos", demoId);
      expect(fs.existsSync(demoDir)).toBe(true);

      // Frontend page
      expect(fs.existsSync(path.join(demoDir, "page.tsx"))).toBe(true);
      const page = fs.readFileSync(path.join(demoDir, "page.tsx"), "utf-8");
      expect(page).toContain("CopilotKit");
      expect(page).toContain("CopilotChat");

      // Agent file (Python for this test)
      expect(fs.existsSync(path.join(demoDir, "agent.py"))).toBe(true);

      // README
      expect(fs.existsSync(path.join(demoDir, "README.md"))).toBe(true);

      // E2E test
      expect(
        fs.existsSync(path.join(TEST_DIR, "tests", "e2e", `${demoId}.spec.ts`)),
      ).toBe(true);

      // QA template
      expect(fs.existsSync(path.join(TEST_DIR, "qa", `${demoId}.md`))).toBe(
        true,
      );
    }
  });

  it("generates TypeScript agent files for TS integrations", () => {
    cleanup();

    runGenerator([
      "--name",
      "Test TS",
      "--slug",
      TEST_SLUG,
      "--category",
      "agent-framework",
      "--language",
      "typescript",
      "--features",
      "agentic-chat",
    ]);

    const demoDir = path.join(TEST_DIR, "src", "app", "demos", "agentic-chat");
    expect(fs.existsSync(path.join(demoDir, "agent.ts"))).toBe(true);
    expect(fs.existsSync(path.join(demoDir, "agent.py"))).toBe(false);

    // No requirements.txt for TS
    expect(fs.existsSync(path.join(TEST_DIR, "requirements.txt"))).toBe(false);
  });

  it("generates manifest with all declared features and demos", () => {
    cleanup();

    const features = [
      "agentic-chat",
      "hitl-in-chat",
      "tool-rendering",
      "mcp-apps",
    ];

    runGenerator([
      "--name",
      "Test",
      "--slug",
      TEST_SLUG,
      "--category",
      "agent-framework",
      "--language",
      "python",
      "--features",
      features.join(","),
    ]);

    const manifest = yaml.parse(
      fs.readFileSync(path.join(TEST_DIR, "manifest.yaml"), "utf-8"),
    );

    expect(manifest.features).toEqual(features);
    expect(manifest.demos.length).toBe(features.length);

    for (const demo of manifest.demos) {
      expect(features).toContain(demo.id);
      expect(demo.name).toBeTruthy();
      expect(demo.description).toBeTruthy();
      expect(demo.route).toMatch(/^\/demos\//);
      expect(demo.tags.length).toBeGreaterThan(0);
    }
  });

  it("refuses to create a package if directory already exists", () => {
    cleanup();

    // Create first
    runGenerator([
      "--name",
      "Test",
      "--slug",
      TEST_SLUG,
      "--category",
      "agent-framework",
      "--language",
      "python",
      "--features",
      "agentic-chat",
    ]);

    // Try to create again — the generator should refuse.
    try {
      runGenerator([
        "--name",
        "Test",
        "--slug",
        TEST_SLUG,
        "--category",
        "agent-framework",
        "--language",
        "python",
        "--features",
        "agentic-chat",
      ]);
      expect.fail("Should have thrown");
    } catch (e: any) {
      const stream =
        (e.stderr?.toString?.() ?? "") + (e.stdout?.toString?.() ?? "");
      expect(stream).toContain("already exists");
    }
  });

  it("validates feature IDs against the registry", () => {
    const featureRegistry = JSON.parse(
      fs.readFileSync(FEATURE_REGISTRY_PATH, "utf-8"),
    );

    // All features in the registry should have valid IDs
    for (const feature of featureRegistry.features) {
      expect(feature.id).toMatch(/^[a-z0-9-]+$/);
      expect(feature.name).toBeTruthy();
      expect(feature.category).toBeTruthy();
      expect(feature.description).toBeTruthy();
    }

    // Registry should have all expected categories
    const categories = new Set(
      featureRegistry.categories.map((c: any) => c.id),
    );
    expect(categories.has("chat-ui")).toBe(true);
    expect(categories.has("generative-ui")).toBe(true);
    expect(categories.has("agent-state")).toBe(true);
    expect(categories.has("interactivity")).toBe(true);
    expect(categories.has("multi-agent")).toBe(true);
    expect(categories.has("platform")).toBe(true);
  });

  // Regression guard — the test-integration-tmp leak.
  //
  // Before the cleanup fix, running the generator scaffolded a package into
  // showcase/packages/ AND mutated three CI workflow YAMLs. cleanup() only
  // removed the package dir; the workflow mutations leaked into the working
  // tree and on Node 20 CI produced `Timeout calling "onTaskUpdate"` ->
  // ELIFECYCLE on every PR.
  //
  // This test asserts `cleanup()` restores every workflow YAML bit-for-bit.
  // The same `cleanup()` function runs in `afterEach`, so covering it here
  // transitively covers the hook. The sentinel append below deliberately
  // causes transient tracking drift on the workflow YAMLs for the duration
  // of the test — a developer with a git GUI / file watcher will see flicker
  // while this test runs; restore() heals it before the test returns.
  it("cleanup restores workflow YAMLs after generator mutation (regression: test-integration-tmp leak)", () => {
    cleanup();

    // Verify we captured at least one workflow to test against.
    expect(workflowRestorer.snapshotMap.size).toBeGreaterThan(0);

    // Run the generator with a dedicated slug so it always has fresh work to
    // do (the generator short-circuits once its slug is registered in any
    // workflow file).
    runGenerator([
      "--name",
      "Leak Guard",
      "--slug",
      REGRESSION_SLUG,
      "--category",
      "agent-framework",
      "--language",
      "python",
      "--features",
      "agentic-chat",
    ]);

    // Capture pre-sentinel content so we can prove the append was observed
    // by the filesystem via a content check (stronger than byte-length:
    // resistant to a hypothetical fs shim that updates stat but not bytes).
    const preAppendContent = new Map<string, Buffer>();
    for (const p of workflowRestorer.snapshotMap.keys()) {
      preAppendContent.set(p, fs.readFileSync(p));
    }

    // Defense in depth: force every snapshotted file to differ from its
    // baseline regardless of generator output. Safe because we restore
    // immediately below via cleanup().
    const SENTINEL = "\n# regression-guard-sentinel\n";
    const sentinelBuf = Buffer.from(SENTINEL, "utf-8");
    for (const p of workflowRestorer.snapshotMap.keys()) {
      fs.appendFileSync(p, SENTINEL);
    }

    // Prove the sentinel actually landed on disk — the file must be
    // pre-append content followed by sentinel bytes, exactly. Replaces the
    // old tautological `anyMutated` check (which couldn't fail given the
    // append ran unconditionally directly above it).
    for (const p of workflowRestorer.snapshotMap.keys()) {
      const before = preAppendContent.get(p)!;
      const expected = Buffer.concat([before, sentinelBuf]);
      const actual = fs.readFileSync(p);
      expect(
        actual.equals(expected),
        `sentinel append did not land on ${p}`,
      ).toBe(true);
    }

    // Run cleanup() and assert bit-for-bit restoration against the module
    // snapshot (NOT a local re-read of disk — that would silently agree with
    // a buggy workflowRestorer.restore()).
    cleanup();

    for (const [p, baseline] of workflowRestorer.snapshotMap) {
      const current = fs.readFileSync(p);
      expect(
        current.equals(baseline),
        `workflow drift not restored: ${p}`,
      ).toBe(true);
    }

    // Both package dirs should be gone.
    expect(fs.existsSync(TEST_DIR)).toBe(false);
    expect(fs.existsSync(REGRESSION_DIR)).toBe(false);
  });

  // Safety net: every snapshotted workflow must match its captured baseline
  // bit-for-bit at the end of the suite. Compares against the in-memory
  // snapshot rather than `git diff`, so a developer editing an unrelated
  // workflow locally doesn't get spurious failures — we only care about
  // files the suite knows about.
  it("leaves every snapshotted workflow byte-identical to its baseline", () => {
    expect(workflowRestorer.snapshotMap.size).toBeGreaterThan(0);
    for (const [p, baseline] of workflowRestorer.snapshotMap) {
      const current = fs.readFileSync(p);
      expect(current.equals(baseline), `workflow drift after suite: ${p}`).toBe(
        true,
      );
    }
  });
});
