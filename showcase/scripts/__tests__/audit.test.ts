import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import {
  auditPackage,
  buildReport,
  listShowcasePackageSlugs,
  readManifest,
  countFiles,
  findExamplesSource,
  parseArgs,
  BORN_IN_SHOWCASE,
  SLUG_TO_EXAMPLES,
  type AuditConfig,
} from "../audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUDIT_SCRIPT = path.resolve(__dirname, "..", "audit.ts");

/**
 * Build a throwaway temp tree mimicking:
 *   <root>/packages/<slug>/manifest.yaml
 *   <root>/packages/<slug>/tests/e2e/*.spec.ts
 *   <root>/packages/<slug>/qa/*.md
 *   <root>/examples/integrations/<name>/
 */
function makeTmpTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-fixture-"));
  fs.mkdirSync(path.join(root, "packages"), { recursive: true });
  fs.mkdirSync(path.join(root, "examples", "integrations"), {
    recursive: true,
  });
  return root;
}

function makeConfig(root: string): AuditConfig {
  return {
    packagesDir: path.join(root, "packages"),
    examplesIntegrationsDir: path.join(root, "examples", "integrations"),
    repoRoot: root,
  };
}

function writePackage(
  root: string,
  slug: string,
  opts: {
    manifest?: string; // raw YAML string; undefined = no manifest.yaml
    specs?: string[];
    qaFiles?: string[];
  },
) {
  const pkgDir = path.join(root, "packages", slug);
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

function makeExampleDir(root: string, name: string) {
  fs.mkdirSync(path.join(root, "examples", "integrations", name), {
    recursive: true,
  });
}

describe("readManifest", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpTree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns { kind: 'missing' } when manifest.yaml does not exist", () => {
    writePackage(root, "mypkg", {});
    const cfg = makeConfig(root);
    const r = readManifest("mypkg", cfg);
    expect(r.kind).toBe("missing");
  });

  it("returns { kind: 'malformed', error } when manifest.yaml is malformed YAML", () => {
    writePackage(root, "mypkg", {
      manifest: "slug: mypkg\n  bad:: indent: [unterminated\n",
    });
    const cfg = makeConfig(root);
    const r = readManifest("mypkg", cfg);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(typeof r.error).toBe("string");
      expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it("returns { kind: 'ok', manifest } for a valid manifest", () => {
    writePackage(root, "mypkg", {
      manifest: "slug: mypkg\ndeployed: true\ndemos:\n  - id: foo\n",
    });
    const cfg = makeConfig(root);
    const r = readManifest("mypkg", cfg);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.manifest.slug).toBe("mypkg");
      expect(r.manifest.deployed).toBe(true);
      expect(r.manifest.demos?.length).toBe(1);
    }
  });

  it("returns { kind: 'malformed' } for empty manifest.yaml (yaml.parse → null)", () => {
    // yaml.parse("") returns null, and previously the parsed-as-Manifest
    // cast let null propagate into downstream .demos / .deployed access,
    // crashing with TypeError. Empty/non-object YAML must be rejected here
    // before auditPackage touches it.
    writePackage(root, "mypkg", { manifest: "" });
    const cfg = makeConfig(root);
    const r = readManifest("mypkg", cfg);
    expect(r.kind).toBe("malformed");
  });

  it("returns { kind: 'malformed' } when manifest.yaml parses to a non-object (e.g. bare scalar)", () => {
    // yaml.parse("42") returns the number 42 — also not a valid Manifest.
    writePackage(root, "mypkg", { manifest: "42\n" });
    const cfg = makeConfig(root);
    const r = readManifest("mypkg", cfg);
    expect(r.kind).toBe("malformed");
  });
});

describe("countFiles", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpTree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns { kind: 'missing', count: 0 } when dir does not exist", () => {
    const r = countFiles(path.join(root, "does-not-exist"), (n) =>
      n.endsWith(".spec.ts"),
    );
    expect(r.kind).toBe("missing");
    expect(r.count).toBe(0);
  });

  it("returns { kind: 'ok', count: N } for readable dir", () => {
    const d = path.join(root, "some");
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "a.spec.ts"), "");
    fs.writeFileSync(path.join(d, "b.spec.ts"), "");
    fs.writeFileSync(path.join(d, "c.md"), "");
    const r = countFiles(d, (n) => n.endsWith(".spec.ts"));
    expect(r.kind).toBe("ok");
    expect(r.count).toBe(2);
  });

  it("surfaces { kind: 'error' } instead of silent 0 on readdirSync failure", () => {
    const d = path.join(root, "unreadable");
    fs.mkdirSync(d);
    // Mock readdirSync to throw EACCES for this specific path.
    const orig = fs.readdirSync;
    const spy = vi.spyOn(fs, "readdirSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === d) {
        const e: NodeJS.ErrnoException = new Error("EACCES: permission denied");
        e.code = "EACCES";
        throw e;
      }
      return (orig as unknown as (p: fs.PathLike, o?: unknown) => unknown)(
        p,
        options,
      );
    }) as typeof fs.readdirSync);
    try {
      const r = countFiles(d, (n) => n.endsWith(".spec.ts"));
      expect(r.kind).toBe("error");
      expect(r.count).toBe(0);
      if (r.kind === "error") {
        expect(r.error).toContain("EACCES");
      }
    } finally {
      spy.mockRestore();
    }
  });
});

describe("findExamplesSource", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpTree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns null when no candidate directory exists", () => {
    const cfg = makeConfig(root);
    const r = findExamplesSource("does-not-exist", cfg);
    expect(r).toBeNull();
  });

  it("returns relative path when a candidate dir exists", () => {
    makeExampleDir(root, "crewai-crews");
    const cfg = makeConfig(root);
    const r = findExamplesSource("crewai-crews", cfg);
    expect(r).toBe(path.join("examples", "integrations", "crewai-crews"));
  });

  it("does not crash if statSync throws — treats error as not-found", () => {
    makeExampleDir(root, "crewai-crews");
    const target = path.join(root, "examples", "integrations", "crewai-crews");
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === target) {
        const e: NodeJS.ErrnoException = new Error("EIO: race condition");
        e.code = "EIO";
        throw e;
      }
      return (orig as unknown as (p: fs.PathLike, o?: unknown) => unknown)(
        p,
        options,
      );
    }) as typeof fs.statSync);
    try {
      const cfg = makeConfig(root);
      const r = findExamplesSource("crewai-crews", cfg);
      expect(r).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("auditPackage", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpTree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits 'malformed manifest.yaml' (not 'missing') for bad YAML", () => {
    writePackage(root, "broken", {
      manifest: "demos: [[[\nunterminated\n",
    });
    const cfg = makeConfig(root);
    const a = auditPackage("broken", cfg);
    expect(a.manifestFound).toBe(false);
    expect(
      a.anomalies.some((s) => s.startsWith("malformed manifest.yaml")),
    ).toBe(true);
    expect(a.anomalies.some((s) => s === "missing manifest.yaml")).toBe(false);
  });

  it("emits 'missing manifest.yaml' when no manifest.yaml exists", () => {
    writePackage(root, "noman", {});
    const cfg = makeConfig(root);
    const a = auditPackage("noman", cfg);
    expect(a.manifestFound).toBe(false);
    expect(a.anomalies).toContain("missing manifest.yaml");
  });

  it("does not crash and emits 'malformed manifest.yaml' for an empty manifest.yaml", () => {
    // yaml.parse("") → null; if the guard is missing, auditPackage will
    // throw TypeError when it reads manifest.demos / manifest.deployed.
    writePackage(root, "empty", { manifest: "" });
    const cfg = makeConfig(root);
    expect(() => auditPackage("empty", cfg)).not.toThrow();
    const a = auditPackage("empty", cfg);
    expect(a.manifestFound).toBe(false);
    expect(a.manifestMalformed).toBe(true);
    expect(
      a.anomalies.some((s) => s.startsWith("malformed manifest.yaml")),
    ).toBe(true);
  });

  it("does not flag missingExamples for born-in-showcase slugs", () => {
    const slug = "ag2"; // known born-in-showcase
    expect(BORN_IN_SHOWCASE.has(slug)).toBe(true);

    writePackage(root, slug, {
      manifest: `slug: ${slug}\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    // Intentionally DO NOT create an examples/integrations/ag2 directory.
    const cfg = makeConfig(root);
    const a = auditPackage(slug, cfg);
    expect(a.anomalies.some((s) => s.includes("examples/integrations"))).toBe(
      false,
    );
  });

  it("born-in-showcase + deployed:true → zero anomalies (clean)", () => {
    const slug = "claude-sdk-typescript";
    expect(BORN_IN_SHOWCASE.has(slug)).toBe(true);
    writePackage(root, slug, {
      manifest: `slug: ${slug}\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    const cfg = makeConfig(root);
    const a = auditPackage(slug, cfg);
    expect(a.anomalies).toEqual([]);
  });

  it("surfaces 'could not read' anomaly when spec dir readdir fails", () => {
    writePackage(root, "perm", {
      manifest: `slug: perm\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    const e2eDir = path.join(root, "packages", "perm", "tests", "e2e");
    const orig = fs.readdirSync;
    const spy = vi.spyOn(fs, "readdirSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === e2eDir) {
        const e: NodeJS.ErrnoException = new Error("EACCES");
        e.code = "EACCES";
        throw e;
      }
      return (orig as unknown as (p: fs.PathLike, o?: unknown) => unknown)(
        p,
        options,
      );
    }) as typeof fs.readdirSync);
    try {
      const cfg = makeConfig(root);
      const a = auditPackage("perm", cfg);
      expect(a.anomalies.some((s) => s.startsWith("could not read"))).toBe(
        true,
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("buildReport", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpTree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("counts clean vs anomaly packages correctly", () => {
    writePackage(root, "crewai-crews", {
      manifest: `slug: crewai-crews\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    makeExampleDir(root, "crewai-crews");
    writePackage(root, "ag2", {
      manifest: `slug: ag2\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    writePackage(root, "anomalous", {
      manifest: `slug: anomalous\ndeployed: false\ndemos:\n  - id: a\n  - id: b\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    const cfg = makeConfig(root);
    const report = buildReport(["crewai-crews", "ag2", "anomalous"], cfg);
    expect(report.totals.total).toBe(3);
    expect(report.totals.clean).toBe(2);
    expect(report.totals.withAnomalies).toBe(1);
  });
});

describe("parseArgs", () => {
  it("treats --slug as requiring a non-flag argument (not --json)", () => {
    const r = parseArgs(["--slug", "--json"]);
    expect(r.slug).toBeNull();
    expect(r.json).toBe(true);
    expect(r.errors.some((e) => e.includes("--slug"))).toBe(true);
  });

  it("treats --slug followed by a flag as missing value", () => {
    const r = parseArgs(["--slug"]);
    expect(r.slug).toBeNull();
    expect(r.errors.some((e) => e.includes("--slug"))).toBe(true);
  });

  it("parses --slug <value> correctly", () => {
    const r = parseArgs(["--slug", "mastra"]);
    expect(r.slug).toBe("mastra");
    expect(r.errors).toEqual([]);
  });

  it("parses --json and --slug together", () => {
    const r = parseArgs(["--json", "--slug", "mastra"]);
    expect(r.slug).toBe("mastra");
    expect(r.json).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe("BORN_IN_SHOWCASE set", () => {
  it("contains the 5 known born-in-showcase slugs", () => {
    expect(BORN_IN_SHOWCASE.has("ag2")).toBe(true);
    expect(BORN_IN_SHOWCASE.has("claude-sdk-python")).toBe(true);
    expect(BORN_IN_SHOWCASE.has("claude-sdk-typescript")).toBe(true);
    expect(BORN_IN_SHOWCASE.has("langroid")).toBe(true);
    expect(BORN_IN_SHOWCASE.has("spring-ai")).toBe(true);
  });
});

describe("SLUG_TO_EXAMPLES — dead entries removed", () => {
  // These showcase slugs do not exist under showcase/packages/. Keeping
  // them in the map produced phantom "no examples source" anomalies for
  // nothing (and made the table/doc noise confusing). Each is a
  // regression guard: if you add any of these back, you must create the
  // corresponding showcase/packages/<slug>/ dir too.
  it.each(["crewai-flows", "agent-spec-langgraph", "mcp-apps"])(
    "does not include dead entry %s",
    (slug) => {
      expect(SLUG_TO_EXAMPLES[slug]).toBeUndefined();
    },
  );
});

describe("findExamplesSource — runtime warning for mapped slug with no dir", () => {
  let root: string;
  let warnings: string[];
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    root = makeTmpTree();
    warnings = [];
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      warnings.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
      );
      return true;
    }) as typeof process.stderr.write);
  });
  afterEach(() => {
    stderrSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits stderr warning (not error) when a SLUG_TO_EXAMPLES-mapped slug has no matching dir", () => {
    // Pick a slug that IS in SLUG_TO_EXAMPLES (so we hit the mapped path)
    // but intentionally create no examples/integrations/<mapped> dir.
    const mappedSlug = Object.keys(SLUG_TO_EXAMPLES)[0];
    expect(mappedSlug).toBeDefined();
    const cfg = makeConfig(root);
    const r = findExamplesSource(mappedSlug, cfg);
    expect(r).toBeNull();
    const joined = warnings.join("");
    expect(joined).toMatch(/warn/i);
    expect(joined).toContain(mappedSlug);
  });

  it("does NOT warn for an unmapped slug missing a dir (falls back to slug==dirname)", () => {
    // A slug not in SLUG_TO_EXAMPLES falls back to [slug]. That's the
    // "no mapping" case — not a dead entry — so no warning.
    const cfg = makeConfig(root);
    const r = findExamplesSource("totally-unmapped-slug", cfg);
    expect(r).toBeNull();
    const joined = warnings.join("");
    expect(joined).not.toMatch(/warn/i);
  });
});

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
      expect(r.stderr).toMatch(/packages/i);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
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

  it("exits 2 on internal error (bad arg combination: --slug --json)", () => {
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
});

describe("listShowcasePackageSlugs", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpTree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns sorted slug list", () => {
    writePackage(root, "beta", {});
    writePackage(root, "alpha", {});
    writePackage(root, "gamma", {});
    const cfg = makeConfig(root);
    expect(listShowcasePackageSlugs(cfg)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns [] when packages dir does not exist", () => {
    const cfg = {
      ...makeConfig(root),
      packagesDir: path.join(root, "nope"),
    };
    expect(listShowcasePackageSlugs(cfg)).toEqual([]);
  });
});

describe("module isMain guard", () => {
  it("does not execute main() when imported (no process.exit side effect)", async () => {
    // If the import of audit.ts were invoking main() under test, this
    // test file wouldn't be able to run at all (main calls process.exit).
    // So reaching this assertion IS the proof.
    const m = await import("../audit.js");
    expect(typeof m.auditPackage).toBe("function");
    expect(typeof m.buildReport).toBe("function");
  });
});
