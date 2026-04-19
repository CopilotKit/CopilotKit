// create-integration.test.ts — exercises the real generator end-to-end
// against FULLY ISOLATED tmpdir-backed packages and workflows directories.
//
// Previously the test pointed the generator at the real `showcase/packages/`
// and `.github/workflows/` trees and snapshotted the mutated files back to
// HEAD in `afterEach`. Under `fileParallelism: true` that collided with
// `generate-registry.test.ts` (concurrent `readdirSync` of
// `showcase/packages/` saw partial state → ENOENT) AND with every suite that
// healed workflow YAMLs via `git checkout HEAD --` (`.git/index.lock`).
//
// The generator now honors `CREATE_INTEGRATION_PACKAGES_DIR` and
// `CREATE_INTEGRATION_WORKFLOWS_DIR` env overrides. This file creates a
// per-suite tmpdir, seeds it with copies of the real workflow YAMLs (so the
// generator's regex-based edits still match), and points both env vars
// there. No real tracked file is ever mutated — no restorer, no git
// invocation, no cross-suite shared state.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import yaml from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { execOptsFor } from "./test-cleanup";
import { SCRIPTS_DIR, WORKFLOWS_DIR as REAL_WORKFLOWS_DIR } from "./paths";

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

// Exactly the three workflow YAMLs the generator mutates. We seed our
// tmpdir with copies of these real files so the generator's regex-based
// edits have the expected anchors to match against.
const WORKFLOW_BASENAMES: readonly string[] = [
  "showcase_deploy.yml",
  "showcase_drift-detection.yml",
  "starter-smoke.yml",
];

// Lazily populated in `beforeAll` — cast via ! below because TypeScript can't
// follow that these are always set before any test runs.
let TMP_ROOT!: string;
let TMP_PACKAGES_DIR!: string;
let TMP_WORKFLOWS_DIR!: string;
let TEST_DIR!: string;
let REGRESSION_DIR!: string;
// Per-suite baseline of each workflow's content, captured once after seeding
// so `cleanup()` can restore them without re-reading the real files.
const WORKFLOW_BASELINES = new Map<string, Buffer>();

function cleanup() {
  // Remove any scaffolded package dirs the generator produced.
  for (const slug of TEST_SLUGS) {
    const dir = path.join(TMP_PACKAGES_DIR, slug);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  // Restore each seeded workflow to its baseline so the next test starts
  // with the same anchors the generator's regex edits expect.
  for (const [p, baseline] of WORKFLOW_BASELINES) {
    fs.writeFileSync(p, baseline);
  }
}

beforeAll(() => {
  TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "create-integration-"));
  TMP_PACKAGES_DIR = path.join(TMP_ROOT, "packages");
  TMP_WORKFLOWS_DIR = path.join(TMP_ROOT, "workflows");
  TEST_DIR = path.join(TMP_PACKAGES_DIR, TEST_SLUG);
  REGRESSION_DIR = path.join(TMP_PACKAGES_DIR, REGRESSION_SLUG);

  fs.mkdirSync(TMP_PACKAGES_DIR, { recursive: true });
  fs.mkdirSync(TMP_WORKFLOWS_DIR, { recursive: true });

  // Seed our tmp workflows dir from the real files — the generator's regex
  // edits depend on structural anchors that only exist in the production
  // YAMLs. A stale/crashed previous run could leave a real file drifted,
  // but the git-lock-guarded test-cleanup healing on sibling suites will
  // have already fixed that by the time we run.
  for (const basename of WORKFLOW_BASENAMES) {
    const src = path.join(REAL_WORKFLOWS_DIR, basename);
    const dst = path.join(TMP_WORKFLOWS_DIR, basename);
    const content = fs.readFileSync(src);
    fs.writeFileSync(dst, content);
    WORKFLOW_BASELINES.set(dst, content);
  }
});

beforeEach(cleanup);

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** Invoke `npx tsx create-integration/index.ts` with argv-style args so none
 *  of the slug / feature strings ever hit a shell parser. Previous revisions
 *  used `execSync(string)` with interpolated slugs — safe today because the
 *  slugs are constants, but a poor hygiene pattern worth stamping out.
 *
 *  Sets `CREATE_INTEGRATION_{PACKAGES,WORKFLOWS}_DIR` so the generator
 *  writes entirely inside our per-suite tmpdir. */
function runGenerator(args: readonly string[]): { stdout: string } {
  const baseOpts = execOptsFor(SCRIPTS_DIR);
  const stdout = execFileSync(
    "npx",
    ["tsx", "create-integration/index.ts", ...args],
    {
      ...baseOpts,
      env: {
        ...process.env,
        CREATE_INTEGRATION_PACKAGES_DIR: TMP_PACKAGES_DIR,
        CREATE_INTEGRATION_WORKFLOWS_DIR: TMP_WORKFLOWS_DIR,
      },
    },
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

    // Verify we captured at least one workflow baseline to test against.
    expect(WORKFLOW_BASELINES.size).toBeGreaterThan(0);

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
    for (const p of WORKFLOW_BASELINES.keys()) {
      preAppendContent.set(p, fs.readFileSync(p));
    }

    // Defense in depth: force every snapshotted file to differ from its
    // baseline regardless of generator output. Safe because we restore
    // immediately below via cleanup().
    const SENTINEL = "\n# regression-guard-sentinel\n";
    const sentinelBuf = Buffer.from(SENTINEL, "utf-8");
    for (const p of WORKFLOW_BASELINES.keys()) {
      fs.appendFileSync(p, SENTINEL);
    }

    // Prove the sentinel actually landed on disk — the file must be
    // pre-append content followed by sentinel bytes, exactly. Replaces the
    // old tautological `anyMutated` check (which couldn't fail given the
    // append ran unconditionally directly above it).
    for (const p of WORKFLOW_BASELINES.keys()) {
      const before = preAppendContent.get(p)!;
      const expected = Buffer.concat([before, sentinelBuf]);
      const actual = fs.readFileSync(p);
      expect(
        actual.equals(expected),
        `sentinel append did not land on ${p}`,
      ).toBe(true);
    }

    // Run cleanup() and assert bit-for-bit restoration against the in-memory
    // baseline (NOT a local re-read of disk — that would silently agree with
    // a buggy cleanup()).
    cleanup();

    for (const [p, baseline] of WORKFLOW_BASELINES) {
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

  // Safety net: every seeded workflow must match its captured baseline
  // bit-for-bit at the end of the suite. Operates against our tmpdir-backed
  // copies — the real `.github/workflows/` YAMLs are never touched by this
  // suite, so there's nothing in the real tree to drift-check.
  it("leaves every seeded workflow byte-identical to its baseline", () => {
    expect(WORKFLOW_BASELINES.size).toBeGreaterThan(0);
    for (const [p, baseline] of WORKFLOW_BASELINES) {
      const current = fs.readFileSync(p);
      expect(current.equals(baseline), `workflow drift after suite: ${p}`).toBe(
        true,
      );
    }
  });
});
