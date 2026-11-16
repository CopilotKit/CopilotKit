// create-integration.test.ts — exercises the real generator end-to-end
// against FULLY ISOLATED tmpdir-backed packages and workflows directories.
//
// Previously the test pointed the generator at the real `showcase/integrations/`
// and `.github/workflows/` trees and snapshotted the mutated files back to
// HEAD in `afterEach`. Under `fileParallelism: true` that collided with
// `generate-registry.test.ts` (concurrent `readdirSync` of
// `showcase/integrations/` saw partial state → ENOENT) AND with every suite that
// healed workflow YAMLs via `git checkout HEAD --` (`.git/index.lock`).
//
// The generator now honors `CREATE_INTEGRATION_PACKAGES_DIR`,
// `CREATE_INTEGRATION_WORKFLOWS_DIR` and
// `CREATE_INTEGRATION_APP_INTEGRATIONS_DIR` env overrides. This file creates
// a per-suite tmpdir, seeds it with copies of the real workflow YAMLs (so the
// generator's regex-based edits still match), and points the env vars
// there. No real tracked file is ever mutated — no restorer, no git
// invocation, no cross-suite shared state.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import yaml from "yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  loadFeatureRegistry,
  parseArgs,
  updateWorkflows,
} from "../create-integration/index.js";
import { execOptsFor } from "./test-cleanup";
import { SCRIPTS_DIR } from "./paths";

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
/** The column slug the starter-disposition suite scaffolds. */
const DISPOSITION_SLUG = "test-starter-disposition-tmp";
const TEST_SLUGS: readonly string[] = [
  TEST_SLUG,
  REGRESSION_SLUG,
  DISPOSITION_SLUG,
];

// Inline fixture workflow YAMLs — just enough structural anchors for the
// generator's regex-based edits to match. Previously the test seeded from
// the real `.github/workflows/*.yml` files, which meant any drift to
// those files silently broke the test via a hidden dependency (E4). The
// fixtures below are frozen mini-workflows: they carry only the
// anchors documented by `showcase/scripts/create-integration/index.ts`:
//   - `options:` list (workflow_dispatch input)
//   - `outputs:` map with `${{ ... }}` values
//   - `filters: |` block with at least one nested key + list item
//   - `starter:` block sequence for starter-smoke
// and nothing else. If the generator learns new anchors, add them here.
const WORKFLOW_FIXTURES: Record<string, string> = {
  "showcase_deploy.yml": `name: Showcase Deploy
on:
  workflow_dispatch:
    inputs:
      service:
        description: Which service to deploy
        required: false
        default: all
        type: choice
        options:
          - all
          - fixture-a
          - fixture-b
jobs:
  detect-changes:
    name: Detect Changes
    runs-on: ubuntu-latest
    outputs:
      fixture_a: \${{ steps.changes.outputs.fixture_a }}
      fixture_b: \${{ steps.changes.outputs.fixture_b }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: changes
        with:
          filters: |
            fixture_a:
              - 'showcase/integrations/fixture-a/**'
            fixture_b:
              - 'showcase/integrations/fixture-b/**'
  check-lockfile:
    name: Check Lockfile
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo ok
`,
  "test_smoke-starter.yml": `name: Starter Smoke
on: { workflow_dispatch: {} }
jobs:
  smoke:
    strategy:
      matrix:
        starter:
          - fixture-a
          - fixture-b
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo ok
`,
};
const WORKFLOW_BASENAMES: readonly string[] = Object.keys(WORKFLOW_FIXTURES);

/**
 * Hermetic stand-in for `showcase/tests/e2e/starter-smoke.spec.ts`.
 *
 * The generator now writes BOTH halves of the smoke-matrix pair, so without a
 * path override these tests would edit the REAL spec in the repo. Deliberately
 * heterogeneous — a one-line entry and a multi-line object — because the real
 * array is, and the insertion anchors on the array's TERMINATOR rather than on
 * "the last entry" precisely so a multi-line tail cannot break it.
 */
const SMOKE_SPEC_FIXTURE = `import { test } from "@playwright/test";

const DEFAULT_STARTER = { hasAppMode: false };

const STARTERS: Starter[] = [
  { ...DEFAULT_STARTER, slug: "fixture-a" },
  {
    ...DEFAULT_STARTER,
    slug: "fixture-b",
    chatMessage: "hello",
  },
];

test("noop", () => {});
`;

// Lazily populated in `beforeAll` — cast via ! below because TypeScript can't
// follow that these are always set before any test runs.
let TMP_ROOT!: string;
let TMP_SMOKE_SPEC!: string;
let TMP_PACKAGES_DIR!: string;
let TMP_WORKFLOWS_DIR!: string;
// Stands in for showcase/frontends/nextjs/src/integrations/.
let TMP_APP_INTEGRATIONS_DIR!: string;
let TEST_DIR!: string;
let REGRESSION_DIR!: string;
// Per-suite baseline of each workflow's content, captured once after seeding
// so `cleanup()` can restore them without re-reading the real files.
const WORKFLOW_BASELINES = new Map<string, Buffer>();

function cleanup() {
  // Remove any scaffolded package dirs and app integration folders the
  // generator produced.
  for (const slug of TEST_SLUGS) {
    for (const dir of [
      path.join(TMP_PACKAGES_DIR, slug),
      path.join(TMP_APP_INTEGRATIONS_DIR, slug),
    ]) {
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
  TMP_PACKAGES_DIR = path.join(TMP_ROOT, "integrations");
  TMP_WORKFLOWS_DIR = path.join(TMP_ROOT, "workflows");
  TMP_SMOKE_SPEC = path.join(TMP_ROOT, "starter-smoke.spec.ts");
  TMP_APP_INTEGRATIONS_DIR = path.join(TMP_ROOT, "app-integrations");
  TEST_DIR = path.join(TMP_PACKAGES_DIR, TEST_SLUG);
  REGRESSION_DIR = path.join(TMP_PACKAGES_DIR, REGRESSION_SLUG);

  fs.mkdirSync(TMP_PACKAGES_DIR, { recursive: true });
  fs.mkdirSync(TMP_WORKFLOWS_DIR, { recursive: true });

  // Seed our tmp workflows dir from frozen inline fixtures. Pre-fix (E4)
  // this copied from `.github/workflows/` — any drift there silently
  // broke the test because the regex anchors lived in a file outside
  // this suite's control. The WORKFLOW_FIXTURES constants above carry
  // the anchors the generator expects; the suite is now hermetic.
  for (const basename of WORKFLOW_BASENAMES) {
    const dst = path.join(TMP_WORKFLOWS_DIR, basename);
    const content = Buffer.from(WORKFLOW_FIXTURES[basename]!, "utf-8");
    fs.writeFileSync(dst, content);
    WORKFLOW_BASELINES.set(dst, content);
  }

  // The smoke spec is restored by `cleanup()` alongside the workflows, for the
  // same reason: the generator mutates it and a leaked mutation would make the
  // next case's assertions depend on run order.
  const specContent = Buffer.from(SMOKE_SPEC_FIXTURE, "utf-8");
  fs.writeFileSync(TMP_SMOKE_SPEC, specContent);
  WORKFLOW_BASELINES.set(TMP_SMOKE_SPEC, specContent);
});

beforeEach(cleanup);

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** The hermetic smoke-spec's current content. */
function readFileSyncSpec(): string {
  return fs.readFileSync(TMP_SMOKE_SPEC, "utf-8");
}

/**
 * Run the generator expecting a NON-ZERO exit, and return its stderr.
 *
 * Asserting only `toThrow()` is not enough and this helper exists because of a
 * concrete near-miss: with the mutually-exclusive check weakened to
 * `hasPath && hasReason`, a run with NEITHER flag fell through and crashed with
 * a TypeError on `undefined.trim()` — non-zero exit, `toThrow()` green, the
 * guard gone. Matching the usage text is what distinguishes "rejected with a
 * usage error" from "crashed".
 */
function expectGeneratorError(args: readonly string[]): string {
  try {
    runGenerator(args);
  } catch (err) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
    return String(e.stderr ?? "") + String(e.stdout ?? "");
  }
  throw new Error("expected the generator to exit non-zero, but it succeeded");
}

/**
 * Generator arguments for a column with no starter. The display name never
 * matters to these tests, so every run uses the same one.
 */
function scaffoldArgs(
  features: string,
  options: {
    language?: "python" | "typescript";
    category?: string;
    slug?: string;
  } = {},
) {
  return [
    "--name",
    "Test Integration",
    "--slug",
    options.slug ?? TEST_SLUG,
    "--category",
    options.category ?? "agent-framework",
    "--language",
    options.language ?? "python",
    "--features",
    features,
    "--starter-reason",
    "No starter template exists for this test fixture integration.",
  ];
}

/** Invoke `npx tsx create-integration/index.ts` with argv-style args so none
 *  of the slug / feature strings ever hit a shell parser. Previous revisions
 *  used `execSync(string)` with interpolated slugs. That was safe because the
 *  slugs are constants, but it is a poor hygiene pattern worth stamping out.
 *
 *  Sets the `CREATE_INTEGRATION_*` overrides (packages, workflows, smoke
 *  spec, app integrations) so the generator writes entirely inside our
 *  per-suite tmpdir. */
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
        CREATE_INTEGRATION_SMOKE_SPEC: TMP_SMOKE_SPEC,
        CREATE_INTEGRATION_APP_INTEGRATIONS_DIR: TMP_APP_INTEGRATIONS_DIR,
      },
    },
  );
  return { stdout: stdout.toString() };
}

describe("Template Generator", () => {
  it("generates a valid package structure", () => {
    cleanup();

    runGenerator(scaffoldArgs("agentic-chat,hitl-in-chat"));

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

    const gitignore = fs.readFileSync(
      path.join(TEST_DIR, ".gitignore"),
      "utf-8",
    );
    expect(gitignore.split(/\r?\n/)).toContain(".copilotkit/");
  });

  it("writes no per-integration e2e setup, because the shared suite covers the demos", () => {
    cleanup();

    runGenerator(scaffoldArgs("agentic-chat,hitl-in-chat"));

    for (const entry of [
      "tests",
      "playwright.config.ts",
      "docker-compose.test.yml",
      "fixtures",
    ]) {
      expect(fs.existsSync(path.join(TEST_DIR, entry)), entry).toBe(false);
    }
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(TEST_DIR, "package.json"), "utf-8"),
    );
    expect(Object.keys(packageJson.scripts)).not.toContain("test:e2e");
    expect(Object.keys(packageJson.devDependencies)).not.toContain(
      "@playwright/test",
    );
    const gitignore = fs.readFileSync(
      path.join(TEST_DIR, ".gitignore"),
      "utf-8",
    );
    expect(gitignore.split(/\r?\n/)).not.toContain("playwright-report/");
  });

  it("writes env.ts and agents.ts for the integration in the unified app", () => {
    cleanup();

    // cli-start is a feature but not a demo of the app, so agents.ts has
    // no entry for it.
    runGenerator(scaffoldArgs("agentic-chat,subagents,cli-start"));

    const appDir = path.join(TMP_APP_INTEGRATIONS_DIR, TEST_SLUG);
    const env = fs.readFileSync(path.join(appDir, "env.ts"), "utf-8");
    expect(env).toContain(
      'import type { IntegrationEnv } from "@/lib/agents";',
    );
    expect(env).toContain("AGENT_URL_TEST_INTEGRATION_TMP: { port: 8000 },");
    expect(env).toContain("} satisfies IntegrationEnv;");

    const agents = fs.readFileSync(path.join(appDir, "agents.ts"), "utf-8");
    // The page's agent ids come from DEMO_AGENT_IDS when the app runs.
    expect(agents).toContain('import { DEMO_AGENT_IDS } from "@/demo-agents";');
    expect(agents).toContain(
      [
        "const AGENT_PATHS: Partial<Record<string, string>> = {",
        '  "agentic-chat": "/",',
        '  subagents: "/",',
        "};",
      ].join("\n"),
    );
    expect(agents).toContain('httpAgent("test-integration-tmp", path)');
    expect(agents).toContain("} satisfies IntegrationRuntime;");
  });

  it("generates a manifest that passes schema validation", () => {
    cleanup();

    runGenerator(
      scaffoldArgs("agentic-chat,tool-rendering,mcp-apps", {
        language: "typescript",
        category: "provider-sdk",
      }),
    );

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

    runGenerator(scaffoldArgs("agentic-chat,hitl-in-chat,subagents"));

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

      // QA template
      expect(fs.existsSync(path.join(TEST_DIR, "qa", `${demoId}.md`))).toBe(
        true,
      );
    }
  });

  it("generates TypeScript agent files for TS integrations", () => {
    cleanup();

    runGenerator(scaffoldArgs("agentic-chat", { language: "typescript" }));

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

    runGenerator(scaffoldArgs(features.join(",")));

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
    runGenerator(scaffoldArgs("agentic-chat"));

    // Try to create again — the generator should refuse.
    expect(expectGeneratorError(scaffoldArgs("agentic-chat"))).toContain(
      "already exists",
    );
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
    expect(categories.has("controlled-generative-ui")).toBe(true);
    expect(categories.has("declarative-generative-ui")).toBe(true);
    expect(categories.has("open-generative-ui")).toBe(true);
    expect(categories.has("operational-generative-ui")).toBe(true);
    expect(categories.has("agent-state")).toBe(true);
    expect(categories.has("interactivity")).toBe(true);
    expect(categories.has("multi-agent")).toBe(true);
    expect(categories.has("platform")).toBe(true);
  });

  // Regression guard — the test-integration-tmp leak.
  //
  // Before the cleanup fix, running the generator scaffolded a package into
  // showcase/integrations/ AND mutated two CI workflow YAMLs (showcase_deploy.yml
  // and test_smoke-starter.yml). cleanup() only removed the package dir; the
  // workflow mutations leaked into the working tree and on Node 20 CI produced
  // `Timeout calling "onTaskUpdate"` -> ELIFECYCLE on every PR.
  //
  // This test asserts `cleanup()` restores every workflow YAML bit-for-bit.
  // The same `cleanup()` function runs in `beforeEach`, so covering it here
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
    runGenerator(scaffoldArgs("agentic-chat", { slug: REGRESSION_SLUG }));

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

  // VT-M2-C regression: on an idempotent re-run against a slug that is
  // already present in the `starter:` matrix of test_smoke-starter.yml,
  // the generator must skip the insert quietly instead of throwing
  // "found 'starter:' block in ... but it has zero entries". Previously
  // the walker set `lastEntryIndex = -1` on already-present to signal
  // "skip", which then fell into the same else branch as the degenerate
  // zero-entries case and surfaced a misleading error for operators
  // whose workflow was already correctly wired.
  it("re-running against a slug already in the smoke-matrix is a no-op, not a throw (VT-M2-C)", () => {
    cleanup();

    const args = [
      "--name",
      "Idempotent Rerun",
      "--slug",
      REGRESSION_SLUG,
      "--category",
      "agent-framework",
      "--language",
      "python",
      "--features",
      "agentic-chat",
      // This pair asserts the smoke-matrix append and then the idempotent
      // skip, so it needs the branch that actually touches the smoke files.
      // The path is a REAL directory that is NOT in the fixture matrix, and
      // deliberately one whose basename differs from the column slug: the
      // matrix and the spec list EXAMPLE slugs, and appending the column slug
      // into them was the namespace bug this change fixes.
      "--starter-path",
      "examples/integrations/claude-sdk-python",
    ];
    const STARTER_SLUG = "claude-sdk-python";

    // First run: scaffolds the package, appends the STARTER slug to the
    // `starter:` matrix in test_smoke-starter.yml and to STARTERS in the smoke
    // spec, AND inserts options/outputs/filters/build-job entries into
    // showcase_deploy.yml.
    runGenerator(args);
    const smokePath = path.join(TMP_WORKFLOWS_DIR, "test_smoke-starter.yml");
    const deployPath = path.join(TMP_WORKFLOWS_DIR, "showcase_deploy.yml");
    const afterFirstRun = fs.readFileSync(smokePath, "utf-8");
    const deployAfterFirstRun = fs.readFileSync(deployPath, "utf-8");
    expect(afterFirstRun).toMatch(
      new RegExp(`^\\s+- ${STARTER_SLUG}\\s*$`, "m"),
    );
    // The column slug must NOT land in the matrix — that is the namespace bug.
    expect(afterFirstRun).not.toMatch(
      new RegExp(`^\\s+- ${REGRESSION_SLUG}\\s*$`, "m"),
    );
    // BOTH halves of the pair moved.
    const specAfterFirstRun = fs.readFileSync(TMP_SMOKE_SPEC, "utf-8");
    expect(specAfterFirstRun).toContain(`slug: "${STARTER_SLUG}"`);
    // showcase_deploy.yml insertions use the underscored `slugVar`
    // (hyphens → underscores). This is the form the idempotency
    // guards must look for on re-run. (VT-M2-F regression anchor.)
    const regressionSlugVar = REGRESSION_SLUG.replace(/-/g, "_");
    expect(deployAfterFirstRun).toMatch(
      new RegExp(`^\\s+${regressionSlugVar}: \\$\\{\\{`, "m"),
    );
    expect(deployAfterFirstRun).toMatch(
      new RegExp(`^\\s*build-${regressionSlugVar}:`, "m"),
    );

    // Remove only the scaffolded package dir so the generator's pre-flight
    // guard lets us run again — the workflow already contains the slug,
    // which is the state we're exercising.
    fs.rmSync(path.join(TMP_PACKAGES_DIR, REGRESSION_SLUG), {
      recursive: true,
      force: true,
    });

    // Second run must succeed (not throw). Expected output contains the
    // already-present skip notice; it MUST NOT contain the
    // "zero entries" degenerate-case error text.
    const { stdout } = runGenerator(args);
    expect(stdout).toMatch(/already present in starter matrix/);
    expect(stdout).toMatch(/already present in STARTERS/);
    expect(stdout).not.toMatch(/has zero entries/);

    // test_smoke-starter.yml must be unchanged bit-for-bit across the
    // second run (no duplicate insert, no formatting drift).
    const afterSecondRun = fs.readFileSync(smokePath, "utf-8");
    expect(afterSecondRun).toBe(afterFirstRun);
    // …and so must the spec: exactly one entry, no duplicate insert.
    expect(fs.readFileSync(TMP_SMOKE_SPEC, "utf-8")).toBe(specAfterFirstRun);

    // showcase_deploy.yml MUST also be unchanged bit-for-bit across the
    // second run. This is the VT-M2-F regression: prior to the fix the
    // outputs/filters idempotency guard compared against the hyphenated
    // `slug` while the insertion wrote the underscored `slugVar`, so a
    // re-run against a hyphenated slug like `test-integration-tmp-
    // regression-guard` would never match the guard and would append
    // duplicate `<slugVar>:` entries under outputs: and filters: on
    // every re-run, corrupting the YAML.
    const deployAfterSecondRun = fs.readFileSync(deployPath, "utf-8");
    expect(deployAfterSecondRun).toBe(deployAfterFirstRun);

    // Belt-and-suspenders: there must be exactly one output entry and
    // exactly one filter entry keyed by `<slugVar>:`, no duplicates.
    const outputKeyMatches = deployAfterSecondRun.match(
      new RegExp(`^\\s+${regressionSlugVar}: \\$\\{\\{`, "gm"),
    );
    expect(outputKeyMatches?.length).toBe(1);
    const buildJobMatches = deployAfterSecondRun.match(
      new RegExp(`^\\s*build-${regressionSlugVar}:`, "gm"),
    );
    expect(buildJobMatches?.length).toBe(1);
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

describe("Template Generator — hardening regressions", () => {
  it("fails fast with a listed-ids error on unknown --features", () => {
    cleanup();
    const combined = expectGeneratorError(
      scaffoldArgs("agentic-chat,not-a-real-feature"),
    );
    expect(combined).toMatch(/Unknown feature id/);
    expect(combined).toContain("not-a-real-feature");
    // Error message must enumerate known ids so the user can self-correct.
    expect(combined).toContain("Known ids:");
    expect(combined).toContain("agentic-chat");
    // Partial directory must NOT be left behind on a validation failure.
    expect(fs.existsSync(TEST_DIR)).toBe(false);
  });

  it("loadFeatureRegistry surfaces structured errors for read/parse/shape failures", () => {
    // Replace the vacuous SHOWCASE_FEATURE_REGISTRY env-var test with
    // direct-import coverage. We spy on fs.readFileSync so we can inject
    // each failure mode deterministically — ENOENT, invalid JSON, and
    // shape-invalid (missing 'features' array) — and assert that the
    // thrown error message names the registry path AND the failure mode
    // rather than leaking a bare stack. The previous env-var approach
    // was a no-op: create-integration/index.ts never reads that env var,
    // and the test's own short-circuit (if /SHOWCASE_FEATURE_REGISTRY/
    // matched) meant the asserts never ran.

    // Capture the real readFileSync once so each case can delegate
    // for paths that are NOT the feature registry. An unfiltered
    // mockImplementation intercepts ALL readFileSync calls — including
    // the ones vitest/tsx make internally to resolve source maps,
    // transforms, etc. — and produces flaky failures that have nothing
    // to do with the code under test. Mirror the pattern used in
    // validate-parity.test.ts / manifest.test.ts.
    const realRead = fs.readFileSync;
    const delegate = (
      p: fs.PathOrFileDescriptor,
      ...rest: unknown[]
    ): string | Buffer =>
      (
        realRead as unknown as (
          p: fs.PathOrFileDescriptor,
          ...rest: unknown[]
        ) => string | Buffer
      )(p, ...rest);

    // Case 1: ENOENT (file missing).
    {
      const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        ...rest: unknown[]
      ) => {
        if (typeof p === "string" && p.endsWith("feature-registry.json")) {
          const err = new Error(
            "ENOENT: no such file or directory",
          ) as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return delegate(p, ...rest);
      }) as typeof fs.readFileSync);
      try {
        expect(() => loadFeatureRegistry()).toThrow(
          /Failed to read feature registry/i,
        );
      } finally {
        spy.mockRestore();
      }
    }

    // Case 2: invalid JSON.
    {
      const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        ...rest: unknown[]
      ) => {
        if (typeof p === "string" && p.endsWith("feature-registry.json")) {
          return "{ this is not valid json }";
        }
        return delegate(p, ...rest);
      }) as typeof fs.readFileSync);
      try {
        expect(() => loadFeatureRegistry()).toThrow(/not valid JSON/i);
      } finally {
        spy.mockRestore();
      }
    }

    // Case 3: shape-invalid — top-level array.
    {
      const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        ...rest: unknown[]
      ) => {
        if (typeof p === "string" && p.endsWith("feature-registry.json")) {
          return JSON.stringify([{ id: "x" }]);
        }
        return delegate(p, ...rest);
      }) as typeof fs.readFileSync);
      try {
        expect(() => loadFeatureRegistry()).toThrow(
          /must be a JSON object with a 'features' array/i,
        );
      } finally {
        spy.mockRestore();
      }
    }

    // Case 4: shape-invalid — object without 'features' key.
    {
      const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        ...rest: unknown[]
      ) => {
        if (typeof p === "string" && p.endsWith("feature-registry.json")) {
          return JSON.stringify({ categories: [] });
        }
        return delegate(p, ...rest);
      }) as typeof fs.readFileSync);
      try {
        expect(() => loadFeatureRegistry()).toThrow(
          /must be a JSON object with a 'features' array/i,
        );
      } finally {
        spy.mockRestore();
      }
    }
  });

  it("validates feature-registry shape (top-level object with 'features' array)", () => {
    // The loader rejects registries that drop the { features: [...] } wrapper
    // so a hand-edited file surfaces as a clear error at load time rather
    // than as 'features is undefined' further down the call stack.
    // We assert the shape that the loader depends on is actually present.
    const raw = fs.readFileSync(FEATURE_REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).not.toBeNull();
    expect(typeof parsed).toBe("object");
    expect(Array.isArray(parsed.features)).toBe(true);
    // And every entry has the shape the loader types against
    for (const f of parsed.features) {
      expect(typeof f.id).toBe("string");
      expect(f.id.length).toBeGreaterThan(0);
    }
  });

  it("generated health route has an in-process branch for TypeScript integrations", async () => {
    cleanup();
    runGenerator(scaffoldArgs("agentic-chat", { language: "typescript" }));

    const healthRoute = fs.readFileSync(
      path.join(TEST_DIR, "src/app/api/health/route.ts"),
      "utf-8",
    );
    // Must not probe a bogus agent URL for an in-process TS integration;
    // instead the flag must be hard-wired and the runtime must short-circuit
    // to the in-process status.
    expect(healthRoute).toContain("IS_IN_PROCESS = true");
    expect(healthRoute).toContain('"in-process"');
    // And the happy-path must treat in-process as 200 alongside "ok"
    expect(healthRoute).toMatch(
      /agentStatus\s*===\s*"ok"\s*\|\|\s*agentStatus\s*===\s*"in-process"/,
    );
  });

  it("generated health route has an out-of-process probe for Python integrations", async () => {
    cleanup();
    runGenerator(scaffoldArgs("agentic-chat"));

    const healthRoute = fs.readFileSync(
      path.join(TEST_DIR, "src/app/api/health/route.ts"),
      "utf-8",
    );
    expect(healthRoute).toContain("IS_IN_PROCESS = false");
    expect(healthRoute).toContain("AbortSignal.timeout(3000)");
  });

  it("generated layout.tsx contains bare backticks in the inline script, not literal \\`", async () => {
    cleanup();
    runGenerator(scaffoldArgs("agentic-chat"));

    const layout = fs.readFileSync(
      path.join(TEST_DIR, "src/app/layout.tsx"),
      "utf-8",
    );
    // Previously the generator emitted \\\` which produced a literal \` in
    // the output, breaking the template-literal assignment to __html.
    expect(layout).not.toContain("\\`");
    // The legitimate bare backticks must still be present so the script
    // body actually parses.
    expect(layout).toMatch(/__html:\s*`/);
  });

  describe("parseArgs — unit coverage for argv-walking guards", () => {
    // parseArgs reads process.argv and calls process.exit(1) on any invalid
    // shape. We stub both so each failure mode is observed via a thrown
    // "process.exit called" sentinel and the matching error text on stderr.
    // Each branch below exercises one guard the hardening added so the
    // argv-walking logic doesn't silently drop flags or accept bad values.
    it("rejects a positional argument that doesn't start with --", () => {
      const argv = process.argv;
      process.argv = ["node", "index.ts", "stray", "--name", "x"];
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
        code?: number,
      ) => {
        throw new Error(`exit:${code}`);
      }) as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        expect(() => parseArgs()).toThrow(/exit:1/);
        const combined = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
        expect(combined).toMatch(/Unexpected positional argument 'stray'/);
      } finally {
        process.argv = argv;
        exitSpy.mockRestore();
        errSpy.mockRestore();
      }
    });

    it("rejects a --flag missing its value (end-of-args)", () => {
      const argv = process.argv;
      process.argv = ["node", "index.ts", "--name"];
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
        code?: number,
      ) => {
        throw new Error(`exit:${code}`);
      }) as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        expect(() => parseArgs()).toThrow(/exit:1/);
        const combined = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
        expect(combined).toMatch(/Flag --name expects a value/);
        expect(combined).toMatch(/end-of-args/);
      } finally {
        process.argv = argv;
        exitSpy.mockRestore();
        errSpy.mockRestore();
      }
    });

    it("rejects a --flag followed by another --flag instead of a value", () => {
      const argv = process.argv;
      process.argv = ["node", "index.ts", "--name", "--slug", "x"];
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
        code?: number,
      ) => {
        throw new Error(`exit:${code}`);
      }) as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        expect(() => parseArgs()).toThrow(/exit:1/);
        const combined = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
        expect(combined).toMatch(/Flag --name expects a value/);
        expect(combined).toMatch(/another flag \(--slug\)/);
      } finally {
        process.argv = argv;
        exitSpy.mockRestore();
        errSpy.mockRestore();
      }
    });

    it("rejects an unknown --category value with the listed allowed set", () => {
      const argv = process.argv;
      process.argv = [
        "node",
        "index.ts",
        "--name",
        "x",
        "--slug",
        "x",
        "--category",
        "not-a-category",
        "--language",
        "python",
        "--features",
        "agentic-chat",
      ];
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
        code?: number,
      ) => {
        throw new Error(`exit:${code}`);
      }) as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        expect(() => parseArgs()).toThrow(/exit:1/);
        const combined = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
        expect(combined).toMatch(/Unknown --category 'not-a-category'/);
        // The listed allowed set must include the canonical categories
        // so the user can self-correct from the message alone.
        expect(combined).toContain("provider-sdk");
      } finally {
        process.argv = argv;
        exitSpy.mockRestore();
        errSpy.mockRestore();
      }
    });
  });

  describe("updateWorkflows — regex-failure assertions", () => {
    // updateWorkflows arguments for a column with no starter, so the smoke
    // files stay out of the run.
    function workflowArgs(slug: string) {
      return {
        name: "X",
        slug,
        category: "agent-framework",
        language: "python",
        features: ["agentic-chat"],
        extraDeps: [],
        starter: {
          kind: "reason",
          reason: "No starter template exists for this test fixture.",
        },
      } satisfies Parameters<typeof updateWorkflows>[0];
    }

    // updateWorkflows walks two workflow YAML files (showcase_deploy.yml
    // and test_smoke-starter.yml). Inside showcase_deploy.yml it performs
    // three regex-anchored block insertions (options:, outputs:, filters:),
    // each of which is covered by its own test below. If the surrounding
    // YAML drifts so the regex no longer matches, the hardening requires
    // it to throw a targeted error that names the file and mode — not to
    // silently write a no-op.
    // We drive the failure via a tiny shim that re-exports fs with the
    // read/write calls intercepted, letting us substitute an empty YAML
    // body that doesn't contain the expected 'options:' block.
    it("throws when showcase_deploy.yml lacks the options: block", () => {
      // Production uses probePath (statSync) rather than existsSync, so the
      // spy must intercept statSync. Make only showcase_deploy.yml "exist"
      // (return a fake Stats-like object); any other path delegates to the
      // real statSync so vitest/tsx internals keep working. ENOENT on the
      // other workflow(s) makes probePath return "missing" and the
      // corresponding branch is skipped.
      const realStat = fs.statSync;
      const fakeStats = {
        isFile: () => true,
        isDirectory: () => false,
      } as unknown as fs.Stats;
      const statSpy = vi.spyOn(fs, "statSync").mockImplementation(((
        p: fs.PathLike,
        ...rest: unknown[]
      ) => {
        if (String(p).endsWith("showcase_deploy.yml")) return fakeStats;
        const pStr = String(p);
        if (pStr.endsWith("test_smoke-starter.yml")) {
          const err = new Error(
            `ENOENT: no such file or directory, stat '${pStr}'`,
          ) as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return (
          realStat as unknown as (
            p: fs.PathLike,
            ...rest: unknown[]
          ) => fs.Stats
        )(p, ...rest);
      }) as typeof fs.statSync);
      const realRead = fs.readFileSync;
      const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        ...rest: unknown[]
      ) => {
        if (typeof p === "string" && p.endsWith("showcase_deploy.yml")) {
          return "name: deploy\non: push\njobs:\n  noop:\n    runs-on: ubuntu\n";
        }
        return (
          realRead as unknown as (
            p: fs.PathOrFileDescriptor,
            ...rest: unknown[]
          ) => string | Buffer
        )(p, ...rest);
      }) as typeof fs.readFileSync);
      // Prevent the function from actually writing; it shouldn't reach
      // writeFileSync in the throwing branch, but guard anyway so a
      // regression doesn't clobber the real workflow file.
      const writeSpy = vi
        .spyOn(fs, "writeFileSync")
        .mockImplementation(() => {});

      try {
        expect(() => updateWorkflows(workflowArgs("x"))).toThrow(
          /failed to locate the 'options:' block/,
        );
      } finally {
        statSpy.mockRestore();
        readSpy.mockRestore();
        writeSpy.mockRestore();
      }
    });

    it("throws when showcase_deploy.yml lacks the outputs: block", () => {
      // YAML that has a well-formed `options:` block (so the first regex
      // matches and the function proceeds) but no `outputs:` block at
      // all. The second regex must throw with a message that names the
      // outputs block — not silently drop the change.
      const yamlBody = [
        "name: deploy",
        "on:",
        "  workflow_dispatch:",
        "    inputs:",
        "      service:",
        "        type: choice",
        "        options:",
        "          - langgraph-python",
        "          - mastra",
        "jobs:",
        "  noop:",
        "    runs-on: ubuntu",
        "",
      ].join("\n");

      const realStat = fs.statSync;
      const fakeStats = {
        isFile: () => true,
        isDirectory: () => false,
      } as unknown as fs.Stats;
      const statSpy = vi.spyOn(fs, "statSync").mockImplementation(((
        p: fs.PathLike,
        ...rest: unknown[]
      ) => {
        if (String(p).endsWith("showcase_deploy.yml")) return fakeStats;
        const pStr = String(p);
        if (pStr.endsWith("test_smoke-starter.yml")) {
          const err = new Error(
            `ENOENT: no such file or directory, stat '${pStr}'`,
          ) as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return (
          realStat as unknown as (
            p: fs.PathLike,
            ...rest: unknown[]
          ) => fs.Stats
        )(p, ...rest);
      }) as typeof fs.statSync);
      const realRead = fs.readFileSync;
      const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        ...rest: unknown[]
      ) => {
        if (typeof p === "string" && p.endsWith("showcase_deploy.yml")) {
          return yamlBody;
        }
        return (
          realRead as unknown as (
            p: fs.PathOrFileDescriptor,
            ...rest: unknown[]
          ) => string | Buffer
        )(p, ...rest);
      }) as typeof fs.readFileSync);
      const writeSpy = vi
        .spyOn(fs, "writeFileSync")
        .mockImplementation(() => {});

      try {
        expect(() => updateWorkflows(workflowArgs("new-slug"))).toThrow(
          /failed to locate the 'outputs:' block/,
        );
      } finally {
        statSpy.mockRestore();
        readSpy.mockRestore();
        writeSpy.mockRestore();
      }
    });

    it("throws when showcase_deploy.yml lacks the filters: block", () => {
      // YAML that has both `options:` and `outputs:` blocks so the first
      // two regexes match, but no `filters: |` block. The third regex
      // must throw with a message that names the filters block.
      const yamlBody = [
        "name: deploy",
        "on:",
        "  workflow_dispatch:",
        "    inputs:",
        "      service:",
        "        type: choice",
        "        options:",
        "          - langgraph-python",
        "          - mastra",
        "jobs:",
        "  detect-changes:",
        "    runs-on: ubuntu",
        "    outputs:",
        "      langgraph_python: ${{ steps.changes.outputs.langgraph_python }}",
        "      mastra: ${{ steps.changes.outputs.mastra }}",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "",
      ].join("\n");

      const realStat = fs.statSync;
      const fakeStats = {
        isFile: () => true,
        isDirectory: () => false,
      } as unknown as fs.Stats;
      const statSpy = vi.spyOn(fs, "statSync").mockImplementation(((
        p: fs.PathLike,
        ...rest: unknown[]
      ) => {
        if (String(p).endsWith("showcase_deploy.yml")) return fakeStats;
        const pStr = String(p);
        if (pStr.endsWith("test_smoke-starter.yml")) {
          const err = new Error(
            `ENOENT: no such file or directory, stat '${pStr}'`,
          ) as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return (
          realStat as unknown as (
            p: fs.PathLike,
            ...rest: unknown[]
          ) => fs.Stats
        )(p, ...rest);
      }) as typeof fs.statSync);
      const realRead = fs.readFileSync;
      const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        ...rest: unknown[]
      ) => {
        if (typeof p === "string" && p.endsWith("showcase_deploy.yml")) {
          return yamlBody;
        }
        return (
          realRead as unknown as (
            p: fs.PathOrFileDescriptor,
            ...rest: unknown[]
          ) => string | Buffer
        )(p, ...rest);
      }) as typeof fs.readFileSync);
      const writeSpy = vi
        .spyOn(fs, "writeFileSync")
        .mockImplementation(() => {});

      try {
        expect(() => updateWorkflows(workflowArgs("new-slug"))).toThrow(
          /failed to locate the 'filters:' block/,
        );
      } finally {
        statSpy.mockRestore();
        readSpy.mockRestore();
        writeSpy.mockRestore();
      }
    });
  });

  it("demo README contains bare backticks for inline code, not literal \\` pairs", async () => {
    cleanup();
    runGenerator(scaffoldArgs("tool-rendering"));

    const readme = fs.readFileSync(
      path.join(TEST_DIR, "src/app/demos/tool-rendering/README.md"),
      "utf-8",
    );
    // The authored Technical Details section used \\\` which rendered as
    // literal \` in the generated markdown; flag any remaining residue.
    expect(readme).not.toContain("\\`");
    // Must still contain backticked code references (e.g. \`get_weather\`)
    expect(readme).toMatch(/`get_weather`/);
  });
});

// ── The manifest PRODUCER's starter disposition ────────────────────────────
//
// Every consumer sweep for this change looked for code that READS the starter
// keyspace. This script WRITES the two artifacts the starter-validation drift
// assertions grade, and before this change it satisfied neither: it emitted no
// `starter_validation:` block at all (and the schema deliberately does not put
// the key in `required`, so validation could not catch the omission), and it
// appended to `test_smoke-starter.yml`'s matrix while nothing appended to the
// smoke spec's `STARTERS`.
//
// So the first integration anyone scaffolded after the ladder shipped would
// have landed drift assertions 3 and 4 RED in an unrelated author's PR, whose
// cheapest repair is an allowlist — the exact guard-weakening lever
// `EXCLUDED_STARTERS` was deleted to disarm.
//
// All four cases below are RED against the pre-change generator: the first two
// because no `starter_validation` key was emitted at all, the third because the
// spec was never touched, the fourth because the flags did not exist so the run
// exited 0 instead of 1.
describe("Template Generator — starter disposition (manifest producer)", () => {
  const baseArgs = (extra: readonly string[]) => [
    "--name",
    "Starter Disposition",
    "--slug",
    DISPOSITION_SLUG,
    "--category",
    "agent-framework",
    "--language",
    "python",
    "--features",
    "agentic-chat",
    ...extra,
  ];
  const readManifest = () =>
    yaml.parse(
      fs.readFileSync(
        path.join(TMP_PACKAGES_DIR, DISPOSITION_SLUG, "manifest.yaml"),
        "utf-8",
      ),
    );
  const smokeMatrix = () =>
    fs.readFileSync(
      path.join(TMP_WORKFLOWS_DIR, "test_smoke-starter.yml"),
      "utf-8",
    );

  it("--starter-reason emits the {supported:false, reason} branch and touches NEITHER smoke file", () => {
    cleanup();
    const before = { matrix: smokeMatrix(), spec: readFileSyncSpec() };
    runGenerator(
      baseArgs([
        "--starter-reason",
        "This framework has no starter template in examples/integrations.",
      ]),
    );
    const block = readManifest().starter_validation;
    expect(block).toEqual({
      supported: false,
      reason:
        "This framework has no starter template in examples/integrations.",
    });
    // A column with no in-repo starter is not a smoke-matrix member. Appending
    // it would put a COLUMN slug into a list of EXAMPLE slugs.
    expect(smokeMatrix()).toBe(before.matrix);
    expect(readFileSyncSpec()).toBe(before.spec);
  });

  it("--starter-path emits {path} and appends basename(path) to BOTH smoke files", () => {
    cleanup();
    runGenerator(
      baseArgs(["--starter-path", "examples/integrations/claude-sdk-python"]),
    );
    expect(readManifest().starter_validation).toEqual({
      path: "examples/integrations/claude-sdk-python",
    });
    expect(smokeMatrix()).toMatch(/^\s+- claude-sdk-python\s*$/m);
    expect(readFileSyncSpec()).toContain('slug: "claude-sdk-python"');
    // The COLUMN slug must appear in neither — they are a different namespace.
    expect(smokeMatrix()).not.toContain(DISPOSITION_SLUG);
    expect(readFileSyncSpec()).not.toContain(DISPOSITION_SLUG);
  });

  it("--starter-path --starter-service emits the service too", () => {
    cleanup();
    runGenerator(
      baseArgs([
        "--starter-path",
        "examples/integrations/claude-sdk-python",
        "--starter-service",
        "starter-claude-sdk-python",
      ]),
    );
    expect(readManifest().starter_validation).toEqual({
      path: "examples/integrations/claude-sdk-python",
      service: "starter-claude-sdk-python",
    });
  });

  it("a second identical run is a no-op on both smoke files (idempotence)", () => {
    cleanup();
    const args = baseArgs([
      "--starter-path",
      "examples/integrations/claude-sdk-python",
    ]);
    runGenerator(args);
    const afterFirst = { matrix: smokeMatrix(), spec: readFileSyncSpec() };
    fs.rmSync(path.join(TMP_PACKAGES_DIR, DISPOSITION_SLUG), {
      recursive: true,
      force: true,
    });
    runGenerator(args);
    expect(smokeMatrix()).toBe(afterFirst.matrix);
    expect(readFileSyncSpec()).toBe(afterFirst.spec);
  });

  it("neither flag is a USAGE error, not a crash; both flags is a usage error too", () => {
    cleanup();
    // There is deliberately no default: a defaulted `reason` would be
    // schema-valid (`minLength: 1`) and would ship an unreviewed capability
    // claim to users.
    //
    // The message is asserted, not just the non-zero exit. Weakening the
    // mutual-exclusion check to `hasPath && hasReason` ALSO exits non-zero —
    // by crashing on `undefined.trim()` — so a bare `toThrow()` stays green
    // while the guard is gone. This matching is what reds that mutation.
    expect(expectGeneratorError(baseArgs([]))).toMatch(
      /a starter disposition is required/,
    );
    cleanup();
    expect(
      expectGeneratorError(
        baseArgs([
          "--starter-path",
          "examples/integrations/claude-sdk-python",
          "--starter-reason",
          "Both supplied, which must be rejected as a usage error.",
        ]),
      ),
    ).toMatch(/mutually exclusive/);
    cleanup();
    expect(
      expectGeneratorError(
        baseArgs([
          "--starter-reason",
          "No starter exists for this framework at all, anywhere.",
          "--starter-service",
          "starter-nope",
        ]),
      ),
    ).toMatch(/--starter-service is only meaningful with --starter-path/);
  });

  it("--starter-path is checked against the filesystem at authoring time", () => {
    cleanup();
    // Satisfies drift assertion 1b (path reality) when the author runs the
    // scaffolder, rather than in someone else's CI run.
    expect(
      expectGeneratorError(
        baseArgs(["--starter-path", "examples/integrations/no-such-starter"]),
      ),
    ).toMatch(/does not exist/);
  });

  it("--starter-reason rejects a placeholder", () => {
    cleanup();
    expect(
      expectGeneratorError(baseArgs(["--starter-reason", "TODO"])),
    ).toMatch(/must be a real sentence/);
    cleanup();
    expect(
      expectGeneratorError(
        baseArgs([
          "--starter-reason",
          "TODO: work out whether this framework has a starter template.",
        ]),
      ),
    ).toMatch(/TODO\/FIXME\/TBD placeholder/);
  });
});
