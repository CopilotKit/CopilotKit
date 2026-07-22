import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import {
  FileSnapshotRestorer,
  acquireGeneratedDataLock,
  execOptsFor,
  withGeneratedDataLock,
} from "./test-cleanup";
import { SCRIPTS_DIR, SHELL_DATA_DIR } from "./paths";

// `generate-registry.ts` multi-emits registry.json + catalog.json into
// EVERY shell's src/data plus the shell-only constraints.json. Without
// this, every test run leaks regenerated JSON into the working tree —
// catalog.json drifts on every run (its metadata carries a generated_at
// timestamp), so the full write set must be snapshotted, not just the
// shell registry/constraints pair. Snapshot in beforeAll; restore after
// each test and at the end of the suite. These paths overlap with the
// catalog and integration-smoke suites, so each generator mutation window
// holds the generated-data lock.
const SHOWCASE_ROOT = path.resolve(SCRIPTS_DIR, "..");
const DATA_FILES = [
  path.join(SHELL_DATA_DIR, "registry.json"),
  path.join(SHELL_DATA_DIR, "catalog.json"),
  path.join(SHELL_DATA_DIR, "constraints.json"),
  ...["shell-docs", "shell-dojo", "shell-dashboard"].flatMap((pkg) => [
    path.join(SHOWCASE_ROOT, pkg, "src", "data", "registry.json"),
    path.join(SHOWCASE_ROOT, pkg, "src", "data", "catalog.json"),
  ]),
];
const dataRestorer = new FileSnapshotRestorer(DATA_FILES);
let releaseGeneratedDataLock: (() => void) | undefined;

const EXEC_OPTS = execOptsFor(SCRIPTS_DIR);

/** Invoke the generator via argv form — no shell parser involvement. Matches
 *  the hygiene principle in create-integration.test.ts. A prior revision
 *  used `execSync(\`npx tsx ${SCRIPT_PATH}\`)` with an interpolated path,
 *  which is a landmine even when the constant is safe today. */
function runGenerator(): string {
  const out = execFileSync("npx", ["tsx", "generate-registry.ts"], EXEC_OPTS);
  return out.toString();
}

beforeAll(() =>
  withGeneratedDataLock(() => {
    // Generate the data files (they're gitignored, so they may not exist).
    // Running the DEFAULT generator before snapshotting also heals any
    // drift a previously crashed run left behind — the baseline is always
    // fresh default output, never leaked override artifacts (SU7-F3).
    runGenerator();
    dataRestorer.snapshot();
    // Every file in the write set must have been captured — a missing
    // entry means the generator's outputs and DATA_FILES have drifted
    // apart, and the un-snapshotted file would leak mutations into the
    // working tree with no restore (SU7-F3).
    const missing = DATA_FILES.filter((p) => !dataRestorer.snapshotMap.has(p));
    if (missing.length > 0) {
      throw new Error(
        `generate-registry.test.ts: snapshot is missing generated files —` +
          ` DATA_FILES has drifted from the generator's write set:\n` +
          missing.map((p) => `  ${p}`).join("\n"),
      );
    }
  }),
);

beforeEach(() => {
  const release = acquireGeneratedDataLock();
  try {
    dataRestorer.restore();
    releaseGeneratedDataLock = release;
  } catch (err) {
    release();
    throw err;
  }
});

afterEach(() => {
  try {
    dataRestorer.restore();
  } finally {
    releaseGeneratedDataLock?.();
    releaseGeneratedDataLock = undefined;
  }
});

afterAll(() => withGeneratedDataLock(() => dataRestorer.restore()));

// The generator uses __dirname-relative paths, so we test it via the actual
// script against the real showcase directory, using the existing
// langgraph-python package.

describe("Registry Generator", () => {
  it("generates registry.json from existing packages", async () => {
    const stdout = runGenerator();

    expect(stdout).toContain("Generating integration registry");
    expect(stdout).toContain("LangGraph (Python)");

    const registryPath = path.join(SHELL_DATA_DIR, "registry.json");
    expect(fs.existsSync(registryPath)).toBe(true);

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.feature_registry).toBeDefined();
    expect(registry.feature_registry.features.length).toBeGreaterThan(0);
    expect(registry.integrations.length).toBeGreaterThan(0);

    const langgraph = registry.integrations.find(
      (i: any) => i.slug === "langgraph-python",
    );
    expect(langgraph).toBeDefined();
    expect(langgraph.name).toBe("LangGraph (Python)");
    expect(langgraph.category).toBe("popular");
    expect(langgraph.language).toBe("python");

    // Derive the expected counts from the manifest the generator reads, rather
    // than pinning magic numbers — the generator copies `features`/`demos`
    // straight through, so this can't rot when the wired-feature set changes
    // (e.g. the interrupt-pill quarantine that moved gen-ui-interrupt /
    // interrupt-headless from `features:` to `not_supported_features:`).
    const manifestPath = path.resolve(
      SCRIPTS_DIR,
      "..",
      "integrations",
      "langgraph-python",
      "manifest.yaml",
    );
    const yaml = await import("yaml");
    const manifest = yaml.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(langgraph.features.length).toBe(manifest.features.length);
    expect(langgraph.demos.length).toBe(manifest.demos.length);
    expect(
      langgraph.demos.find((demo: any) => demo.id === "agentic-chat")
        .runtime_path,
    ).toBe("/api/copilotkit");
    expect(
      langgraph.demos.find((demo: any) => demo.id === "headless-complete")
        .runtime_path,
    ).toBe("/api/copilotkit-mcp-apps");
  });

  it("sorts integrations by sort_order", () => {
    // Run the generator explicitly — afterEach restores shell/src/data JSONs
    // to HEAD between tests, so we can't rely on test 1's side effect to
    // leave registry.json populated. Mirrors the `runBundlerAndRead` pattern
    // in bundle-demo-content.test.ts tests 2-5.
    runGenerator();

    const registryPath = path.join(SHELL_DATA_DIR, "registry.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));

    // langgraph-python (sort_order: 10) should come before mastra (sort_order: 20)
    const lgIdx = registry.integrations.findIndex(
      (i: any) => i.slug === "langgraph-python",
    );
    const mastraIdx = registry.integrations.findIndex(
      (i: any) => i.slug === "mastra",
    );
    expect(lgIdx).toBeLessThan(mastraIdx);

    // Verify overall order is non-decreasing by sort_order
    for (let i = 1; i < registry.integrations.length; i++) {
      const prevOrder = registry.integrations[i - 1].sort_order ?? 999;
      const currOrder = registry.integrations[i].sort_order ?? 999;
      expect(currOrder).toBeGreaterThanOrEqual(prevOrder);
    }
  });

  it("materializes runtime paths that match canonical demo providers", () => {
    runGenerator();

    const registryPath = path.join(SHELL_DATA_DIR, "registry.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    const mismatches: string[] = [];

    for (const integration of registry.integrations) {
      for (const demo of integration.demos) {
        if (!/^\/api\/copilotkit(?:-[a-z0-9-]+)?$/.test(demo.runtime_path)) {
          mismatches.push(
            `${integration.slug}/${demo.id}: invalid generated runtime_path ${JSON.stringify(demo.runtime_path)}`,
          );
        }
        if (typeof demo.route !== "string") continue;

        const demoDirectory = demo.route.replace(/^\/demos\//, "");
        const pagePath = path.join(
          SHOWCASE_ROOT,
          "integrations",
          integration.slug,
          "src",
          "app",
          "demos",
          demoDirectory,
          "page.tsx",
        );
        if (!fs.existsSync(pagePath)) continue;

        const providerRuntimePath =
          /runtimeUrl\s*=\s*["'](\/api\/copilotkit[^"']*)/.exec(
            fs.readFileSync(pagePath, "utf-8"),
          )?.[1];
        if (
          providerRuntimePath !== undefined &&
          providerRuntimePath !== demo.runtime_path
        ) {
          mismatches.push(
            `${integration.slug}/${demo.id}: provider ${providerRuntimePath}, registry ${demo.runtime_path}`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("validates feature IDs against the registry", async () => {
    const featureRegistryPath = path.resolve(
      SCRIPTS_DIR,
      "..",
      "shared",
      "feature-registry.json",
    );
    const featureRegistry = JSON.parse(
      fs.readFileSync(featureRegistryPath, "utf-8"),
    );
    const validIds = new Set(featureRegistry.features.map((f: any) => f.id));

    const manifestPath = path.resolve(
      SCRIPTS_DIR,
      "..",
      "integrations",
      "langgraph-python",
      "manifest.yaml",
    );
    const yaml = await import("yaml");
    const manifest = yaml.parse(fs.readFileSync(manifestPath, "utf-8"));

    for (const featureId of manifest.features) {
      expect(validIds.has(featureId)).toBe(true);
    }

    for (const demo of manifest.demos) {
      expect(validIds.has(demo.id)).toBe(true);
    }
  });

  // Regression guard — ensures the snapshot/restore hooks defined at the top
  // of this file actually heal drift that `generate-registry.ts` produces in
  // shell/src/data/. If these hooks regress we'll see data-file drift leak
  // into the working tree (same failure mode as the workflow YAML leak
  // fixed in create-integration.test.ts).
  //
  // The sentinel append below creates transient tracking drift on
  // shell/src/data/*.json for the duration of the test; a developer with a
  // git GUI / file watcher will see flicker while it runs. Restore heals it
  // before the test returns.
  it("restores shell/src/data JSONs after the generator mutates them", () => {
    expect(dataRestorer.snapshotMap.size).toBeGreaterThan(0);

    // Run the generator explicitly via the argv-safe helper.
    runGenerator();

    // Capture pre-sentinel content so we can prove the append landed on
    // disk via a content check (stronger than byte-length comparison:
    // resistant to a hypothetical fs shim that updates stat but not bytes).
    const preAppendContent = new Map<string, Buffer>();
    for (const p of dataRestorer.snapshotMap.keys()) {
      preAppendContent.set(p, fs.readFileSync(p));
    }

    // Force each snapshotted file to differ from its snapshot — appending a
    // byte the generator would never write. This makes the test independent
    // of whether the generator's output was byte-identical to the snapshot.
    const SENTINEL = "\n/* regression-guard-sentinel */\n";
    const sentinelBuf = Buffer.from(SENTINEL, "utf-8");
    for (const p of dataRestorer.snapshotMap.keys()) {
      fs.appendFileSync(p, SENTINEL);
    }

    // Verify the sentinel actually landed — the file's bytes must now equal
    // its pre-append content followed by the sentinel bytes, exactly.
    // Fails red under a readonly-fs mock or a buggy appendFileSync shim.
    for (const p of dataRestorer.snapshotMap.keys()) {
      const before = preAppendContent.get(p)!;
      const expected = Buffer.concat([before, sentinelBuf]);
      const actual = fs.readFileSync(p);
      expect(
        actual.equals(expected),
        `sentinel append did not land on ${p}`,
      ).toBe(true);
    }

    // Restore and assert bit-for-bit against the in-memory snapshot (NOT
    // against a re-read of disk, which would silently agree with a buggy
    // restore()).
    dataRestorer.restore();

    for (const [p, baseline] of dataRestorer.snapshotMap) {
      const current = fs.readFileSync(p);
      expect(current.equals(baseline), `data drift not restored: ${p}`).toBe(
        true,
      );
    }
  });

  // Safety net: every snapshotted data file must match its captured baseline
  // bit-for-bit at the end of the suite. Mirrors the equivalent check in
  // create-integration.test.ts.
  it("leaves every snapshotted data file byte-identical to its baseline", () => {
    expect(dataRestorer.snapshotMap.size).toBeGreaterThan(0);
    for (const [p, baseline] of dataRestorer.snapshotMap) {
      const current = fs.readFileSync(p);
      expect(current.equals(baseline), `data drift after suite: ${p}`).toBe(
        true,
      );
    }
  });
});
