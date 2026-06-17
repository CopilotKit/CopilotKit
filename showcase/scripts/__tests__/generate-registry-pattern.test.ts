// SHOWCASE_BACKEND_HOST_PATTERN + error-contract tests for
// generate-registry.ts, run as a subprocess (the script executes main()
// when invoked directly, so its CLI contract — stderr + exit codes — is
// only observable subprocess-wise).
//
// ISOLATION (SU7-F3): every test runs the generator against a throwaway
// tmpdir copy of the showcase tree (scripts + shared + a controlled set
// of integrations), with ALL generator outputs landing inside that
// tmpdir. A previous revision of this suite snapshot/restored the SAME
// working-tree data files that generate-registry.test.ts snapshots,
// violating test-cleanup.ts's documented disjointness contract under
// `fileParallelism: true` — and it captured its baseline WITHOUT a
// healing default generator run, so a crashed override run could poison
// the snapshot for every later run. The per-suite tmpdir eliminates the
// whole shared-mutable-file class structurally: no snapshot, no restore,
// and no working-tree writes at all. This was chosen over merging into
// generate-registry.test.ts (the one-restorer option) because override
// runs here exercise FAILURE paths — keeping those away from the real
// tree entirely is strictly safer than healing the real tree afterwards.

import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { execFileSync } from "child_process";
import { FileSnapshotRestorer, SAFE_EXEC_OPTS } from "./test-cleanup";
import { SCRIPTS_DIR } from "./paths";

const SHOWCASE_ROOT = path.resolve(SCRIPTS_DIR, "..");
const REFERENCE_SLUG = "langgraph-python";
const NON_REFERENCE_SLUG = "mastra";

// Resolve the locally-installed tsx CLI from the real scripts dir and
// spawn it via process.execPath — NOT `npx tsx`: npx without -y can
// prompt-hang when the package isn't cached, and the tmpdir cwd must not
// influence which tsx runs (same hardening as shell/vitest.global-setup.ts).
const TSX_CLI = createRequire(path.join(SCRIPTS_DIR, "package.json")).resolve(
  "tsx/cli",
);

interface Harness {
  root: string;
  scriptsDir: string;
  /** Absolute path to a generator output/input file under the tmp root. */
  file: (...rel: string[]) => string;
}

// Track harness roots and reap them after each test — a failed test must
// not leak tmpdirs across runs.
const harnessRoots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of harnessRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Build a minimal throwaway showcase tree the generator can run against:
 *
 *   <root>/scripts/{generate-registry.ts, validate-constraints.ts,
 *                   package.json, node_modules -> real node_modules}
 *   <root>/shared/{manifest.schema.json, feature-registry.json[,
 *                  constraints.yaml]}
 *   <root>/integrations/<slug>/manifest.yaml   (copied real manifests)
 *
 * The generator resolves every path relative to its own location, so all
 * reads AND writes stay inside the tmpdir.
 */
function makeHarness(
  opts: { integrations?: string[]; constraints?: boolean } = {},
): Harness {
  const {
    integrations = [REFERENCE_SLUG, NON_REFERENCE_SLUG],
    constraints = true,
  } = opts;
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "generate-registry-harness-"),
  );
  harnessRoots.push(root);

  const scriptsDir = path.join(root, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const f of [
    "generate-registry.ts",
    "validate-constraints.ts",
    "package.json",
  ]) {
    fs.copyFileSync(path.join(SCRIPTS_DIR, f), path.join(scriptsDir, f));
  }
  // Bare-specifier resolution (yaml, ajv, ajv-formats) for the copied
  // script — symlink the real node_modules instead of installing.
  fs.symlinkSync(
    path.join(SCRIPTS_DIR, "node_modules"),
    path.join(scriptsDir, "node_modules"),
    "dir",
  );

  const sharedDir = path.join(root, "shared");
  fs.mkdirSync(sharedDir, { recursive: true });
  const sharedFiles = ["manifest.schema.json", "feature-registry.json"];
  if (constraints) sharedFiles.push("constraints.yaml");
  for (const f of sharedFiles) {
    fs.copyFileSync(
      path.join(SHOWCASE_ROOT, "shared", f),
      path.join(sharedDir, f),
    );
  }

  fs.mkdirSync(path.join(root, "integrations"), { recursive: true });
  for (const slug of integrations) {
    const dir = path.join(root, "integrations", slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(
      path.join(SHOWCASE_ROOT, "integrations", slug, "manifest.yaml"),
      path.join(dir, "manifest.yaml"),
    );
  }

  return { root, scriptsDir, file: (...rel) => path.join(root, ...rel) };
}

/**
 * Run the harness's generator copy. `env` entries override the inherited
 * environment; an explicit `undefined` deletes the variable. Ambient
 * pattern vars are always stripped first so a developer shell exporting
 * SHOWCASE_BACKEND_HOST_PATTERN can't skew default/fallback tests.
 */
function runGenerator(
  harness: Harness,
  env: Record<string, string | undefined> = {},
): string {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.SHOWCASE_BACKEND_HOST_PATTERN;
  delete childEnv.NEXT_PUBLIC_SHOWCASE_BACKEND_HOST_PATTERN;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  return execFileSync(process.execPath, [TSX_CLI, "generate-registry.ts"], {
    ...SAFE_EXEC_OPTS,
    cwd: harness.scriptsDir,
    env: childEnv,
  }).toString();
}

type ExecError = Error & { status?: number | null; stderr?: string };

/** Run and expect a non-zero exit; returns the error for stderr asserts. */
function runGeneratorExpectingFailure(
  harness: Harness,
  env: Record<string, string | undefined> = {},
): ExecError {
  let thrown: unknown;
  try {
    runGenerator(harness, env);
  } catch (err) {
    thrown = err;
  }
  expect(thrown, "expected the generator to exit non-zero").toBeInstanceOf(
    Error,
  );
  return thrown as ExecError;
}

function readJson(harness: Harness, ...rel: string[]): any {
  return JSON.parse(fs.readFileSync(harness.file(...rel), "utf-8"));
}

function readRegistry(harness: Harness): {
  integrations: Array<{ slug: string; backend_url: string }>;
} {
  return readJson(harness, "shell", "src", "data", "registry.json");
}

const DEFAULT_BACKEND_HOST_PATTERN =
  "showcase-{slug}-production.up.railway.app";

describe("generate-registry reference-integration error contract (SU7-F3 #1)", () => {
  it("supports the zero-manifests path: emits an empty registry AND an empty catalog, exit 0", () => {
    // main() explicitly logs "No integration packages found. Generating
    // empty registry." — generateCatalog used to crash right after on a
    // non-null assertion for the (absent) reference integration,
    // breaking the supported empty path with a TypeError.
    const harness = makeHarness({ integrations: [] });
    const stdout = runGenerator(harness);
    expect(stdout).toContain("No integration packages found");
    const registry = readRegistry(harness);
    expect(registry.integrations).toEqual([]);
    const catalog = readJson(harness, "shell", "src", "data", "catalog.json");
    expect(catalog.cells).toEqual([]);
    expect(catalog.metadata.total_cells).toBe(0);
    expect(catalog.metadata.wired).toBe(0);
  });

  it(`fails loudly (stderr + exit 1) when integrations exist but the reference (${REFERENCE_SLUG}) is missing`, () => {
    // Parity tiers are computed against the reference integration — with
    // integrations present but the reference absent, the generator must
    // fail per its error contract (labeled stderr + exit 1), not crash
    // with a raw TypeError stack.
    const harness = makeHarness({ integrations: [NON_REFERENCE_SLUG] });
    const e = runGeneratorExpectingFailure(harness);
    expect(e.status).toBe(1);
    expect(e.stderr).toContain(REFERENCE_SLUG);
    expect(e.stderr).toContain("reference");
    expect(e.stderr).not.toContain("TypeError");
  });
});

describe("generate-registry manifest-parse error contract (SU7-F3 #3)", () => {
  it("treats an empty manifest.yaml (yaml.parse -> null) as a validation error, not a TypeError", () => {
    const harness = makeHarness();
    const brokenDir = harness.file("integrations", "broken-empty");
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, "manifest.yaml"), "");
    const e = runGeneratorExpectingFailure(harness);
    expect(e.status).toBe(1);
    expect(e.stderr).toContain("manifest.yaml");
    expect(e.stderr).toContain("YAML mapping");
    expect(e.stderr).not.toContain("TypeError");
  });

  it("treats a scalar manifest.yaml as a validation error too", () => {
    const harness = makeHarness();
    const brokenDir = harness.file("integrations", "broken-scalar");
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, "manifest.yaml"), "just-a-string\n");
    const e = runGeneratorExpectingFailure(harness);
    expect(e.status).toBe(1);
    expect(e.stderr).toContain("YAML mapping");
    expect(e.stderr).not.toContain("TypeError");
  });
});

describe("writeFileAtomicSync tmp naming matches the straggler-sweep convention (SU7-F3 #5)", () => {
  it("names tmp siblings `.<basename>.<16hex>.tmp` so a SIGTERM-killed generator's stragglers get swept", async () => {
    // Importing the generator module must NOT run main() — the script
    // guards the call on direct invocation. Stub the pattern vars
    // before the import anyway so a degenerate ambient value can't trip
    // the module-load {slug} check (which would process.exit the vitest
    // worker).
    vi.stubEnv("SHOWCASE_BACKEND_HOST_PATTERN", "");
    vi.stubEnv("NEXT_PUBLIC_SHOWCASE_BACKEND_HOST_PATTERN", "");
    const { atomicTmpPath } = await import("../generate-registry");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-tmp-naming-"));
    harnessRoots.push(dir);
    const target = path.join(dir, "registry.json");
    fs.writeFileSync(target, "{}\n");

    const tmp = atomicTmpPath(target);
    // Same-directory sibling — rename(2) must stay on one filesystem.
    expect(path.dirname(tmp)).toBe(dir);
    // Named EXACTLY like FileSnapshotRestorer's snapshot-time sweep
    // expects (`^\.<basename>\.[0-9a-f]{16}\.tmp$`). The previous
    // `<target>.<pid>.tmp` shape was invisible to that sweep, so a
    // SIGTERM-killed generator (the one crash mode its try/finally
    // cannot clean up) accumulated un-swept stragglers forever.
    expect(path.basename(tmp)).toMatch(/^\.registry\.json\.[0-9a-f]{16}\.tmp$/);

    // Contract proof: a straggler left at that path is reaped by the
    // restorer's sweep for the same target.
    fs.writeFileSync(tmp, "partial write from a killed generator");
    const restorer = new FileSnapshotRestorer([target]);
    restorer.snapshot();
    expect(fs.existsSync(tmp)).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
  });
});

describe("generate-registry constraints-read error contract (SU7-F3 #4)", () => {
  it("fails with a labeled stderr message + exit 1 when constraints.yaml is missing, not a raw ENOENT stack", () => {
    const harness = makeHarness({ constraints: false });
    const e = runGeneratorExpectingFailure(harness);
    expect(e.status).toBe(1);
    expect(e.stderr).toContain("ERROR");
    expect(e.stderr).toContain("constraints.yaml");
    // The labeled contract, not an unhandled-exception stack trace.
    expect(e.stderr).not.toContain("Object.readFileSync");
  });
});

describe("generate-registry SHOWCASE_BACKEND_HOST_PATTERN contract", () => {
  it("fails loudly (stderr + exit 1) when the pattern lacks the {slug} placeholder", () => {
    const harness = makeHarness();
    const e = runGeneratorExpectingFailure(harness, {
      SHOWCASE_BACKEND_HOST_PATTERN: "no-placeholder.example.com",
    });
    expect(
      e.status,
      "a {slug}-less pattern must fail the build, not bake one host everywhere",
    ).toBe(1);
    expect(e.stderr).toContain("SHOWCASE_BACKEND_HOST_PATTERN");
    expect(e.stderr).toContain("{slug}");
  });

  it("substitutes EVERY {slug} occurrence into backend_url (replaceAll parity with backend-url.ts)", () => {
    const harness = makeHarness();
    runGenerator(harness, {
      SHOWCASE_BACKEND_HOST_PATTERN: "{slug}.demos.example.com/{slug}",
    });
    const registry = readRegistry(harness);
    expect(registry.integrations.length).toBeGreaterThan(0);
    for (const { slug, backend_url } of registry.integrations) {
      expect(backend_url, `backend_url for "${slug}"`).toBe(
        `https://${slug}.demos.example.com/${slug}`,
      );
    }
  });

  // Build-time normalization parity with the runtime consumer
  // (normalizeBackendHostPattern in shell/src/lib/backend-url.ts,
  // SU7-F3): registry.json's baked backend_url values are consumed by
  // shells with NO runtime re-derivation, so a misconfigured env var at
  // build time must normalize the same way it would at request time —
  // not ship corrupted URLs.
  function expectAllBackendUrls(
    harness: Harness,
    hostForSlug: (slug: string) => string,
  ): void {
    const registry = readRegistry(harness);
    expect(registry.integrations.length).toBeGreaterThan(0);
    for (const { slug, backend_url } of registry.integrations) {
      expect(backend_url, `backend_url for "${slug}"`).toBe(
        `https://${hostForSlug(slug)}`,
      );
    }
  }

  it("strips a scheme-bearing pattern instead of baking https://https://… into the registry", () => {
    const harness = makeHarness();
    runGenerator(harness, {
      SHOWCASE_BACKEND_HOST_PATTERN: "https://{slug}.demos.example.com",
    });
    expectAllBackendUrls(harness, (slug) => `${slug}.demos.example.com`);
  });

  it("strips a trailing slash so route concatenation can't yield '//'", () => {
    const harness = makeHarness();
    runGenerator(harness, {
      SHOWCASE_BACKEND_HOST_PATTERN: "{slug}.demos.example.com/",
    });
    expectAllBackendUrls(harness, (slug) => `${slug}.demos.example.com`);
  });

  it("falls back to NEXT_PUBLIC_SHOWCASE_BACKEND_HOST_PATTERN when the primary var is unset (readEnvPair parity)", () => {
    const harness = makeHarness();
    runGenerator(harness, {
      SHOWCASE_BACKEND_HOST_PATTERN: undefined,
      NEXT_PUBLIC_SHOWCASE_BACKEND_HOST_PATTERN: "{slug}.alt.example.com",
    });
    expectAllBackendUrls(harness, (slug) => `${slug}.alt.example.com`);
  });

  it("treats an empty-string primary as unset and falls through to the alternate (readEnvPair parity)", () => {
    const harness = makeHarness();
    runGenerator(harness, {
      SHOWCASE_BACKEND_HOST_PATTERN: "",
      NEXT_PUBLIC_SHOWCASE_BACKEND_HOST_PATTERN: "{slug}.alt.example.com",
    });
    expectAllBackendUrls(harness, (slug) => `${slug}.alt.example.com`);
  });

  it("falls back to the DEFAULT pattern for a degenerate value that cannot form a URL", () => {
    const harness = makeHarness();
    // "https://" normalizes to "" after the scheme strip — unusable, so
    // the generator must fall back to the default pattern (like the
    // runtime does) instead of baking "https://https://" into every
    // backend_url.
    runGenerator(harness, { SHOWCASE_BACKEND_HOST_PATTERN: "https://" });
    expectAllBackendUrls(harness, (slug) =>
      DEFAULT_BACKEND_HOST_PATTERN.replaceAll("{slug}", slug),
    );
  });
});
