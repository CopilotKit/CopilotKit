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
import yaml from "yaml";
import {
  FileSnapshotRestorer,
  acquireGeneratedDataLock,
  execOptsFor,
  withGeneratedDataLock,
} from "./test-cleanup";
import { SCRIPTS_DIR, SHELL_DATA_DIR } from "./paths";

/** The fields these tests read from registry.json. */
interface Registry {
  feature_registry: { features: { id: string }[] };
  integrations: {
    slug: string;
    name: string;
    category: string;
    language: string;
    sort_order?: number;
    features: string[];
    demos: { id: string }[];
  }[];
}

/** The fields these tests read from an integration's manifest.yaml. */
interface ManifestFields {
  features: string[];
  demos: { id: string }[];
}

// `generate-registry.ts` multi-emits registry.json + catalog.json into
// EVERY shell's src/data and the unified app's src/data, plus the
// shell-only constraints.json. Without
// this, every test run leaks regenerated JSON into the working tree, so
// the full write set must be snapshotted, not just the shell
// registry/constraints pair. (catalog.json used to drift on every run too,
// from a wall-clock `generated_at`; PE-110 pinned that stamp to the source
// revision and PE-118 removed the field, but the snapshot is still what
// keeps the rest of the emitted files from leaking.) Snapshot in beforeAll;
// restore after each test and at the end of the suite. These paths overlap
// with the catalog and integration-smoke suites, so each generator mutation
// window holds the generated-data lock.
const SHOWCASE_ROOT = path.resolve(SCRIPTS_DIR, "..");
// The unified Next.js app reads its own copy of the registry from here.
const APP_DATA_DIR = path.join(
  SHOWCASE_ROOT,
  "frontends",
  "nextjs",
  "src",
  "data",
);
const DATA_FILES = [
  path.join(SHELL_DATA_DIR, "registry.json"),
  path.join(SHELL_DATA_DIR, "catalog.json"),
  path.join(SHELL_DATA_DIR, "constraints.json"),
  ...["shell-docs", "shell-dojo", "shell-dashboard"].flatMap((pkg) => [
    path.join(SHOWCASE_ROOT, pkg, "src", "data", "registry.json"),
    path.join(SHOWCASE_ROOT, pkg, "src", "data", "catalog.json"),
  ]),
  path.join(APP_DATA_DIR, "registry.json"),
  path.join(APP_DATA_DIR, "catalog.json"),
];

function readRegistry(registryPath: string) {
  const registry: Registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  return registry;
}

function readLangGraphPythonManifest() {
  const manifestPath = path.resolve(
    SCRIPTS_DIR,
    "..",
    "integrations",
    "langgraph-python",
    "manifest.yaml",
  );
  const manifest: ManifestFields = yaml.parse(
    fs.readFileSync(manifestPath, "utf-8"),
  );
  return manifest;
}
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
  it("generates registry.json from existing packages", () => {
    const stdout = runGenerator();

    expect(stdout).toContain("Generating integration registry");
    expect(stdout).toContain("LangGraph (Python)");

    const registryPath = path.join(SHELL_DATA_DIR, "registry.json");
    expect(fs.existsSync(registryPath)).toBe(true);

    const registry = readRegistry(registryPath);
    expect(registry.feature_registry).toBeDefined();
    expect(registry.feature_registry.features.length).toBeGreaterThan(0);
    expect(registry.integrations.length).toBeGreaterThan(0);

    const langgraph = registry.integrations.find(
      (i) => i.slug === "langgraph-python",
    );
    expect(langgraph).toMatchObject({
      name: "LangGraph (Python)",
      category: "popular",
      language: "python",
    });

    // Derive the expected counts from the manifest the generator reads, rather
    // than pinning magic numbers — the generator copies `features`/`demos`
    // straight through, so this can't rot when the wired-feature set changes
    // (e.g. the interrupt-pill quarantine that moved gen-ui-interrupt /
    // interrupt-headless from `features:` to `not_supported_features:`).
    const manifest = readLangGraphPythonManifest();
    expect(langgraph?.features.length).toBe(manifest.features.length);
    expect(langgraph?.demos.length).toBe(manifest.demos.length);
  });

  it("writes the same registry into the unified app's data folder", () => {
    // Remove the app's copy first, so only this run can write it.
    const appRegistryPath = path.join(APP_DATA_DIR, "registry.json");
    fs.rmSync(appRegistryPath, { force: true });

    runGenerator();

    const slugs = readRegistry(appRegistryPath).integrations.map((i) => i.slug);
    expect(slugs).toContain("langgraph-python");
    const shellRegistry = fs.readFileSync(
      path.join(SHELL_DATA_DIR, "registry.json"),
    );
    expect(fs.readFileSync(appRegistryPath).equals(shellRegistry)).toBe(true);
  });

  it("sorts integrations by sort_order", () => {
    // Run the generator explicitly — afterEach restores shell/src/data JSONs
    // to HEAD between tests, so we can't rely on test 1's side effect to
    // leave registry.json populated. Mirrors the `runBundlerAndRead` pattern
    // in bundle-demo-content.test.ts tests 2-5.
    runGenerator();

    const registry = readRegistry(path.join(SHELL_DATA_DIR, "registry.json"));

    // langgraph-python (sort_order: 10) should come before mastra (sort_order: 20)
    const lgIdx = registry.integrations.findIndex(
      (i) => i.slug === "langgraph-python",
    );
    const mastraIdx = registry.integrations.findIndex(
      (i) => i.slug === "mastra",
    );
    expect(lgIdx).toBeLessThan(mastraIdx);

    // Verify overall order is non-decreasing by sort_order
    for (let i = 1; i < registry.integrations.length; i++) {
      const prevOrder = registry.integrations[i - 1].sort_order ?? 999;
      const currOrder = registry.integrations[i].sort_order ?? 999;
      expect(currOrder).toBeGreaterThanOrEqual(prevOrder);
    }
  });

  it("validates feature IDs against the registry", () => {
    const featureRegistryPath = path.resolve(
      SCRIPTS_DIR,
      "..",
      "shared",
      "feature-registry.json",
    );
    const featureRegistry: Registry["feature_registry"] = JSON.parse(
      fs.readFileSync(featureRegistryPath, "utf-8"),
    );
    const validIds = new Set(featureRegistry.features.map((f) => f.id));

    const manifest = readLangGraphPythonManifest();

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
