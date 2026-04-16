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

  it("exits 2 when SHOWCASE_AUDIT_ROOT points to missing packages dir", () => {
    // Use a fresh temp dir with NO packages subdir.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "audit-empty-"));
    try {
      const r = runCli([], {
        env: { SHOWCASE_AUDIT_ROOT: empty },
      });
      expect(r.status, r.stdout + r.stderr).toBe(2);
      expect(r.stderr).toMatch(/packages/i);
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
