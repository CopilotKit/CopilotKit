import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import {
  auditPackage,
  buildReport,
  computeExitCode,
  listShowcasePackageSlugs,
  readManifest,
  countFiles,
  findExamplesSource,
  resolveExamplesSource,
  parseArgs,
  anomalyMessage,
  UnreadableDirError,
  BORN_IN_SHOWCASE,
  SLUG_TO_EXAMPLES,
  type AuditConfig,
  type Anomaly,
  type PackageAudit,
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

// Helpers that recover the old string-based predicates so tests read like
// a behavioral spec even though the underlying type is now tagged.
function anomalyStrings(a: PackageAudit): string[] {
  return a.anomalies.map(anomalyMessage);
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

  it("passes the dir slug to parseManifest so a slug-mismatch flags as malformed", () => {
    // readManifest must pass the directory slug to parseManifest so
    // a manifest whose declared `slug:` disagrees
    // with the directory holding it is surfaced as a shape error
    // (not silently accepted). Package dir name is "dir-slug" but
    // manifest declares "manifest-slug" — shape validation catches
    // the drift only if dirSlug flows through.
    writePackage(root, "dir-slug", {
      manifest: "slug: manifest-slug\ndeployed: true\ndemos:\n  - id: a\n",
    });
    const cfg = makeConfig(root);
    const r = readManifest("dir-slug", cfg);
    expect(r.kind).toBe("malformed");
    if (r.kind === "malformed") {
      expect(r.subkind).toBe("shape");
      expect(r.error).toMatch(/slug mismatch/);
      expect(r.error).toContain("manifest-slug");
      expect(r.error).toContain("dir-slug");
    }
  });

  it("accepts a manifest whose slug matches the directory name", () => {
    // Counterpart of the slug-mismatch test: when the manifest's
    // declared slug matches the directory slug, parseManifest's guard
    // passes and the kind is 'ok'.
    writePackage(root, "same-slug", {
      manifest: "slug: same-slug\ndeployed: true\ndemos:\n  - id: a\n",
    });
    const cfg = makeConfig(root);
    const r = readManifest("same-slug", cfg);
    expect(r.kind).toBe("ok");
  });

  it("returns { kind: 'unreadable', error } (distinct from 'malformed') on EACCES", () => {
    // Contract: audit.ts does not collapse unreadable into malformed
    // with a string prefix. Downstream switches on all 4 ParsedManifest
    // variants and classifies unreadable manifests under the
    // `unreadable` bucket (alongside spec/qa-dir I/O failures), not
    // under `malformedManifest` (which is content-shape-only).
    writePackage(root, "mypkg", {
      manifest: "slug: mypkg\ndeployed: true\ndemos:\n  - id: foo\n",
    });
    const target = path.join(root, "packages", "mypkg", "manifest.yaml");
    const orig = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
      p: fs.PathOrFileDescriptor,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === target) {
        const e: NodeJS.ErrnoException = new Error("EACCES: permission denied");
        e.code = "EACCES";
        throw e;
      }
      return (
        orig as unknown as (p: fs.PathOrFileDescriptor, o?: unknown) => unknown
      )(p, options);
    }) as typeof fs.readFileSync);
    try {
      const cfg = makeConfig(root);
      const r = readManifest("mypkg", cfg);
      expect(r.kind).toBe("unreadable");
      if (r.kind === "unreadable") {
        expect(r.error).toContain("EACCES");
      }
      // And buildReport routes it under the `unreadable` bucket, NOT
      // `malformedManifest`.
      const report = buildReport(["mypkg"], cfg);
      expect(report.anomalies.unreadable).toContain("mypkg");
      expect(report.anomalies.malformedManifest).not.toContain("mypkg");
    } finally {
      spy.mockRestore();
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

  it("returns { state: 'missing' } when dir does not exist", () => {
    const r = countFiles(path.join(root, "does-not-exist"), (n) =>
      n.endsWith(".spec.ts"),
    );
    expect(r.state).toBe("missing");
  });

  it("returns { state: 'ok', count: N } for readable dir", () => {
    const d = path.join(root, "some");
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "a.spec.ts"), "");
    fs.writeFileSync(path.join(d, "b.spec.ts"), "");
    fs.writeFileSync(path.join(d, "c.md"), "");
    const r = countFiles(d, (n) => n.endsWith(".spec.ts"));
    expect(r.state).toBe("ok");
    if (r.state === "ok") {
      expect(r.count).toBe(2);
    }
  });

  it("surfaces { state: 'unreadable' } instead of silent 0 on readdirSync failure", () => {
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
      expect(r.state).toBe("unreadable");
      if (r.state === "unreadable") {
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

  it("records stale-mapping warnings on the supplied sink array (no stderr monkey-patch)", () => {
    // Regression guard for the old global-state approach: findExamplesSource
    // used to monkey-patch process.stderr.write and restore it in a
    // finally block. Concurrent calls would collide, and any caller that
    // captured stderr (e.g. vitest's stderr spy) saw nothing because
    // the monkey-patch sandwich restored the original. The new contract:
    // pass an explicit string[] sink; warnings are appended to it, and
    // the function never touches process.stderr.
    const mappedSlug = "mastra";
    expect(SLUG_TO_EXAMPLES[mappedSlug]).toBeDefined();
    const cfg = makeConfig(root);
    const sink: string[] = [];
    const r = findExamplesSource(mappedSlug, cfg, sink);
    expect(r).toBeNull();
    // Sink received the stale-mapping warning verbatim.
    expect(sink.length).toBeGreaterThan(0);
    expect(sink.some((w) => w.includes(mappedSlug))).toBe(true);
    expect(sink.some((w) => /warn/i.test(w))).toBe(true);
  });

  it("does not push to the sink when the slug is unmapped (fallback path)", () => {
    // Unmapped slug falls back to [slug] — that's the "no mapping
    // needed" path, not a dead entry, so no warning.
    const cfg = makeConfig(root);
    const sink: string[] = [];
    const r = findExamplesSource("totally-unmapped-slug", cfg, sink);
    expect(r).toBeNull();
    expect(sink).toEqual([]);
  });

  it("statSync failures land on the sink (not stderr)", () => {
    makeExampleDir(root, "crewai-crews");
    const target = path.join(root, "examples", "integrations", "crewai-crews");
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === target) {
        const e: NodeJS.ErrnoException = new Error("EIO: injected");
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
      const sink: string[] = [];
      const r = findExamplesSource("crewai-crews", cfg, sink);
      expect(r).toBeNull();
      expect(sink.some((w) => w.includes("statSync"))).toBe(true);
      expect(sink.some((w) => w.includes("EIO"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns the first declared candidate when only the first exists", () => {
    const slug = "langgraph-typescript";
    const mapped = SLUG_TO_EXAMPLES[slug];
    expect(mapped).toBeDefined();
    expect(mapped!.length).toBeGreaterThan(0);
    const first = mapped![0];
    makeExampleDir(root, first);
    const cfg = makeConfig(root);
    const r = findExamplesSource(slug, cfg);
    expect(r).toBe(path.join("examples", "integrations", first));
  });

  it("falls back to a later candidate when only that later candidate exists", () => {
    // Exercise the multi-candidate fallback path via resolveExamplesSource,
    // which accepts an explicit `mapped` tuple. All live SLUG_TO_EXAMPLES
    // entries are single-candidate today, so using findExamplesSource
    // would short-circuit the fallback loop and leave this codepath
    // uncovered. Synthetic multi-candidate input makes the assertion
    // meaningful regardless of the production map's shape.
    const slug = "synthetic-multi";
    const mapped = ["missing-first", "real-later"] as const;
    makeExampleDir(root, "real-later");
    const cfg = makeConfig(root);
    const r = resolveExamplesSource(slug, mapped, cfg);
    expect(r).toBe(path.join("examples", "integrations", "real-later"));
  });

  it("returns the first candidate when both first and later candidates exist (first wins)", () => {
    // Declared order decides — the first present candidate wins
    // regardless of filesystem enumeration order. Uses synthetic
    // multi-candidate mapping for the same reason as the fallback test
    // above: the live map is single-candidate everywhere.
    const slug = "synthetic-multi";
    const mapped = ["first-dir", "later-dir"] as const;
    makeExampleDir(root, "first-dir");
    makeExampleDir(root, "later-dir");
    const cfg = makeConfig(root);
    const r = resolveExamplesSource(slug, mapped, cfg);
    expect(r).toBe(path.join("examples", "integrations", "first-dir"));
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
    expect(a.manifest.kind).toBe("malformed");
    // The full variant is preserved — callers can reach the underlying
    // error without a second lookup.
    if (a.manifest.kind === "malformed") {
      expect(a.manifest.error).toMatch(/unterminated|Flow sequence|\[/);
    }
    expect(a.anomalies.some((x) => x.kind === "malformed-manifest")).toBe(true);
    expect(a.anomalies.some((x) => x.kind === "missing-manifest")).toBe(false);
  });

  it("emits 'missing manifest.yaml' when no manifest.yaml exists", () => {
    writePackage(root, "noman", {});
    const cfg = makeConfig(root);
    const a = auditPackage("noman", cfg);
    expect(a.manifest.kind).toBe("missing");
    expect(anomalyStrings(a)).toContain("missing manifest.yaml");
  });

  it("does not crash and emits 'malformed manifest.yaml' for an empty manifest.yaml", () => {
    // yaml.parse("") → null; if the guard is missing, auditPackage will
    // throw TypeError when it reads manifest.demos / manifest.deployed.
    writePackage(root, "empty", { manifest: "" });
    const cfg = makeConfig(root);
    expect(() => auditPackage("empty", cfg)).not.toThrow();
    const a = auditPackage("empty", cfg);
    expect(a.manifest.kind).toBe("malformed");
    expect(a.anomalies.some((x) => x.kind === "malformed-manifest")).toBe(true);
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
    expect(a.anomalies.some((x) => x.kind === "missing-examples")).toBe(false);
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
      expect(a.anomalies.some((x) => x.kind === "unreadable-dir")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("surfaces 'could not read' anomaly when qa dir readdir fails (symmetric to spec)", () => {
    writePackage(root, "qaperm", {
      manifest: `slug: qaperm\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    const qaDir = path.join(root, "packages", "qaperm", "qa");
    const orig = fs.readdirSync;
    const spy = vi.spyOn(fs, "readdirSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === qaDir) {
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
      const a = auditPackage("qaperm", cfg);
      const unreadable = a.anomalies.find(
        (x): x is Extract<Anomaly, { kind: "unreadable-dir" }> =>
          x.kind === "unreadable-dir",
      );
      expect(unreadable).toBeDefined();
      expect(unreadable!.dir).toBe(qaDir);
    } finally {
      spy.mockRestore();
    }
  });

  it("deployed:undefined renders as 'deployed=unset' and counts toward notDeployed", () => {
    // Regression guard: a manifest with no `deployed` field MUST produce
    // a distinct "unset" state (not collapsed into "explicit-false").
    // The Anomaly.not-deployed.state carries a self-documenting string
    // union — callers read the raw boolean off the manifest variant.
    writePackage(root, "unset", {
      manifest: `slug: unset\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    makeExampleDir(root, "unset");
    const cfg = makeConfig(root);
    const a = auditPackage("unset", cfg);
    const notDeployed = a.anomalies.find(
      (x): x is Extract<Anomaly, { kind: "not-deployed" }> =>
        x.kind === "not-deployed",
    );
    expect(notDeployed).toBeDefined();
    expect(notDeployed!.state).toBe("unset");
    // Read deployed via the manifest variant — single source of truth.
    expect(a.manifest.kind).toBe("ok");
    if (a.manifest.kind === "ok") {
      expect(a.manifest.manifest.deployed).toBeUndefined();
    }

    // Counterpart: deployed:false is distinct.
    writePackage(root, "falsedep", {
      manifest: `slug: falsedep\ndeployed: false\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    makeExampleDir(root, "falsedep");
    const b = auditPackage("falsedep", cfg);
    const bNot = b.anomalies.find(
      (x): x is Extract<Anomaly, { kind: "not-deployed" }> =>
        x.kind === "not-deployed",
    );
    expect(bNot).toBeDefined();
    expect(bNot!.state).toBe("explicit-false");
    expect(b.manifest.kind).toBe("ok");
    if (b.manifest.kind === "ok") {
      expect(b.manifest.manifest.deployed).toBe(false);
    }

    // Both flow into the notDeployed bucket.
    const report = buildReport(["unset", "falsedep"], cfg);
    expect([...report.anomalies.notDeployed].sort()).toEqual(
      ["falsedep", "unset"].sort(),
    );
  });

  it("records warnings on the `warnings` field for stale SLUG_TO_EXAMPLES entries", () => {
    // Contract: even if stderr is captured/redirected (or if the
    // caller renders JSON and swallows stderr entirely), the audit
    // record itself should carry the warning.
    const mappedSlug = "mastra";
    expect(SLUG_TO_EXAMPLES[mappedSlug]).toBeDefined();
    writePackage(root, mappedSlug, {
      manifest: `slug: ${mappedSlug}\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    // Intentionally DO NOT create the examples/integrations/<mapped> dir.
    const cfg = makeConfig(root);
    const a = auditPackage(mappedSlug, cfg);
    expect(a.warnings.length).toBeGreaterThan(0);
    expect(a.warnings.some((w) => w.includes(mappedSlug))).toBe(true);
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

  it("classifies missing vs malformed manifests into distinct buckets", () => {
    writePackage(root, "missing1", {}); // no manifest.yaml at all
    writePackage(root, "missing2", {});
    writePackage(root, "bad", { manifest: "demos: [[[\nunterminated\n" });
    const cfg = makeConfig(root);
    const report = buildReport(["bad", "missing1", "missing2"], cfg);
    expect([...report.anomalies.missingManifest].sort()).toEqual(
      ["missing1", "missing2"].sort(),
    );
    expect(report.anomalies.malformedManifest).toEqual(["bad"]);
    // Cross-check: no overlap between the two buckets.
    const overlap = report.anomalies.missingManifest.filter((s) =>
      report.anomalies.malformedManifest.includes(s),
    );
    expect(overlap).toEqual([]);
  });

  it("per-dimension countMismatches filter: unreadable spec + real qa mismatch still appears", () => {
    // Package 'mixed' has an unreadable spec dir AND a genuine qa
    // mismatch. The old filter would hide the whole package from
    // countMismatches because *any* 'could not read' was treated as a
    // reason to suppress. The fix: per-dimension suppression — qa
    // mismatch remains visible.
    writePackage(root, "mixed", {
      manifest: `slug: mixed\ndeployed: true\ndemos:\n  - id: a\n  - id: b\n`,
      specs: ["a.spec.ts", "b.spec.ts"],
      qaFiles: ["only-one.md"], // 1 qa vs 2 demos — real mismatch
    });
    makeExampleDir(root, "mixed");

    const e2eDir = path.join(root, "packages", "mixed", "tests", "e2e");
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
      const report = buildReport(["mixed"], cfg);
      // qa mismatch survives suppression (spec dir unreadable should
      // only mask spec-dimension mismatches, not qa-dimension).
      expect(report.anomalies.countMismatches).toContain("mixed");
      // Also verify the underlying anomaly list — qa mismatch present,
      // spec mismatch suppressed by "unreadable spec dir".
      const audit = report.packages.find((p) => p.slug === "mixed")!;
      const mismatches = audit.anomalies.filter(
        (x): x is Extract<Anomaly, { kind: "count-mismatch" }> =>
          x.kind === "count-mismatch",
      );
      expect(mismatches.some((m) => m.dimension === "qa")).toBe(true);
      expect(mismatches.some((m) => m.dimension === "spec")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("populates top-level hasAnomalies and exitCode", () => {
    // JSON output needs the scalar summary so consumers don't have to
    // re-derive it from nested arrays.
    writePackage(root, "ok1", {
      manifest: `slug: ok1\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    makeExampleDir(root, "ok1");
    const cfg = makeConfig(root);
    const clean = buildReport(["ok1"], cfg);
    expect(clean.hasAnomalies).toBe(false);
    expect(clean.exitCode).toBe(0);

    writePackage(root, "bad", {
      manifest: `slug: bad\ndeployed: false\ndemos:\n  - id: a\n`,
      specs: [],
      qaFiles: [],
    });
    const dirty = buildReport(["bad"], cfg);
    expect(dirty.hasAnomalies).toBe(true);
    expect(dirty.exitCode).toBe(1);
  });

  it("withAnomalies is a unique-package count even when buckets overlap", () => {
    // Package "multi" has BOTH a count mismatch AND not-deployed. It
    // appears in countMismatches AND notDeployed (buckets overlap), but
    // totals.withAnomalies counts it once.
    writePackage(root, "multi", {
      manifest: `slug: multi\ndeployed: false\ndemos:\n  - id: a\n  - id: b\n`,
      specs: ["a.spec.ts"], // 1 vs 2 — real spec mismatch
      qaFiles: ["a.md", "b.md"],
    });
    makeExampleDir(root, "multi");
    const cfg = makeConfig(root);
    const report = buildReport(["multi"], cfg);
    expect(report.anomalies.countMismatches).toContain("multi");
    expect(report.anomalies.notDeployed).toContain("multi");
    expect(report.totals.withAnomalies).toBe(1);
  });

  it("freezes PackageAudit entries to prevent downstream mutation", () => {
    writePackage(root, "frozen", {
      manifest: `slug: frozen\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    makeExampleDir(root, "frozen");
    const cfg = makeConfig(root);
    const report = buildReport(["frozen"], cfg);
    const p = report.packages[0];
    expect(Object.isFrozen(p)).toBe(true);
  });

  it("deep-freezes PackageAudit inner containers (anomalies, warnings, spec, qa, manifest)", () => {
    // Regression guard: a shallow freeze would leave
    // `p.anomalies.push(...)` working, so downstream consumers could
    // silently mutate the audit state through a nested reference. The
    // contract is deep-frozen-enough: the record AND its mutable inner
    // containers cannot be reassigned OR pushed to.
    writePackage(root, "deepfrozen", {
      manifest: `slug: deepfrozen\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    makeExampleDir(root, "deepfrozen");
    const cfg = makeConfig(root);
    const report = buildReport(["deepfrozen"], cfg);
    const p = report.packages[0];
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.anomalies)).toBe(true);
    expect(Object.isFrozen(p.warnings)).toBe(true);
    expect(Object.isFrozen(p.spec)).toBe(true);
    expect(Object.isFrozen(p.qa)).toBe(true);
    expect(Object.isFrozen(p.manifest)).toBe(true);
    // "ok" manifest variant should have its inner .manifest object
    // frozen too.
    if (p.manifest.kind === "ok") {
      expect(Object.isFrozen(p.manifest.manifest)).toBe(true);
    }
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

  it("rejects duplicate --json rather than silently accepting last-wins", () => {
    const r = parseArgs(["--json", "--json"]);
    expect(r.json).toBe(true);
    expect(r.errors.some((e) => /--json/.test(e))).toBe(true);
  });

  it("rejects duplicate --slug rather than silently taking last-wins", () => {
    const r = parseArgs(["--slug", "a", "--slug", "b"]);
    expect(r.errors.some((e) => /--slug/.test(e))).toBe(true);
    // Error message should mention both candidate values so the user can
    // tell which occurrences collided.
    expect(r.errors.some((e) => e.includes("a") && e.includes("b"))).toBe(true);
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

  it("every BORN_IN_SHOWCASE slug has no counterpart directory under examples/integrations/ in the real repo", () => {
    // BORN_IN_SHOWCASE is the set of packages that live ONLY under
    // showcase/ — so each slug MUST NOT have a corresponding directory
    // under examples/integrations/. Walk the real repo root and assert.
    const repoExamplesDir = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "examples",
      "integrations",
    );
    // If examples/integrations doesn't exist (unlikely but possible in
    // fixture-only CI), the assertion is vacuously true.
    if (!fs.existsSync(repoExamplesDir)) return;
    for (const slug of BORN_IN_SHOWCASE) {
      const candidate = path.join(repoExamplesDir, slug);
      expect(
        fs.existsSync(candidate),
        `BORN_IN_SHOWCASE slug "${slug}" has a directory under examples/integrations — either remove it from BORN_IN_SHOWCASE or remove the dir`,
      ).toBe(false);
    }
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

  it("every mapped target exists as a dir under examples/integrations/ in the real repo", () => {
    // Dead-entry guard: if any SLUG_TO_EXAMPLES value points at a
    // non-existent examples/integrations/ dir, the audit will emit
    // spurious "no examples source" anomalies at runtime.
    const repoExamplesDir = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "examples",
      "integrations",
    );
    if (!fs.existsSync(repoExamplesDir)) return;
    for (const [slug, targets] of Object.entries(SLUG_TO_EXAMPLES)) {
      for (const target of targets) {
        const candidate = path.join(repoExamplesDir, target);
        expect(
          fs.existsSync(candidate),
          `SLUG_TO_EXAMPLES[${slug}] points at missing dir ${candidate}`,
        ).toBe(true);
      }
    }
  });
});

describe("findExamplesSource — sink-based warnings (no global stderr)", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpTree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("populates the caller-supplied sink when a mapped slug has no matching dir", () => {
    // Use an explicit slug known to be in SLUG_TO_EXAMPLES rather than
    // first-key indexing, which would silently keep passing if the map
    // changed order.
    const mappedSlug = "mastra";
    expect(SLUG_TO_EXAMPLES[mappedSlug]).toBeDefined();
    const cfg = makeConfig(root);
    const sink: string[] = [];
    const r = findExamplesSource(mappedSlug, cfg, sink);
    expect(r).toBeNull();
    const joined = sink.join("\n");
    expect(joined).toMatch(/warn/i);
    expect(joined).toContain(mappedSlug);
  });

  it("does NOT populate the sink for an unmapped slug missing a dir (falls back to slug==dirname)", () => {
    // A slug not in SLUG_TO_EXAMPLES falls back to [slug]. That's the
    // "no mapping" case — not a dead entry — so no warning.
    const cfg = makeConfig(root);
    const sink: string[] = [];
    const r = findExamplesSource("totally-unmapped-slug", cfg, sink);
    expect(r).toBeNull();
    expect(sink).toEqual([]);
  });

  it("does NOT write to process.stderr at all (hard guarantee — no global state)", () => {
    // Regression guard for the stderr-monkey-patch contract removal:
    // findExamplesSource is a pure function with respect to
    // stdout/stderr. Callers pass an explicit sink or accept that
    // warnings are discarded.
    const stderrWrites: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stderrWrites.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
      );
      return true;
    }) as typeof process.stderr.write);
    try {
      const mappedSlug = "mastra";
      const cfg = makeConfig(root);
      findExamplesSource(mappedSlug, cfg, []);
      expect(stderrWrites).toEqual([]);
    } finally {
      spy.mockRestore();
    }
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

  it("exits 3 (unreadable) when packages path exists but is a file, not a directory", () => {
    // Regression guard: previously `readdirSync` on a file path threw
    // ENOTDIR inside the try/catch in listShowcasePackageSlugs which
    // returned [], so the CLI collapsed to "empty packages" (exit 1). We
    // now distinguish this with a dedicated stat() check — exit 3.
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "audit-file-"));
    try {
      // Create <fixture>/packages as a FILE, not a directory.
      fs.writeFileSync(path.join(fixture, "packages"), "not a dir\n");
      const r = runCli([], {
        env: { SHOWCASE_AUDIT_ROOT: fixture },
      });
      expect(r.status, r.stdout + r.stderr).toBe(3);
      expect(r.stderr).toMatch(/not a directory/i);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
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
    expect(r.stderr).toMatch(/audit: warning:/);
  });

  it("exits 4 (internal error) on unexpected exceptions", () => {
    // Inject a TypeError AFTER the top-level packages dir has been
    // listed successfully, so the UnreadableDirError fast-path (which
    // would route to exit 3) does NOT swallow it. We override
    // `fs.existsSync` so that the initial existence check (on the
    // packages dir itself) passes, then start throwing TypeError for
    // every subsequent existsSync call — readManifest's existsSync
    // call on `<root>/packages/foo/manifest.yaml` is NOT wrapped in
    // try/catch inside parseManifest, so the TypeError escapes all
    // downstream handlers and reaches the top-level main() catch,
    // which routes it to EXIT_INTERNAL (4) via the programmer-bug
    // branch.
    const preload = fs.mkdtempSync(path.join(os.tmpdir(), "audit-preload-"));
    const preloadScript = path.join(preload, "boom.cjs");
    fs.writeFileSync(
      preloadScript,
      `const fs = require("fs");
const origExists = fs.existsSync;
let allowed = 1; // let the top-level packagesDir check through
fs.existsSync = function(...args) {
  const p = String(args[0] || "");
  if (allowed > 0 && p.endsWith("packages")) {
    allowed--;
    return origExists.apply(this, args);
  }
  throw new TypeError("simulated bug: should never happen");
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
        ["tsx", "--require", preloadScript, AUDIT_SCRIPT],
        {
          env: { ...process.env, SHOWCASE_AUDIT_ROOT: root },
          encoding: "utf-8",
          timeout: 30_000,
        },
      );
      // The injected failure fires from inside parseManifest /
      // findExamplesSource (downstream of listShowcasePackageSlugs),
      // so UnreadableDirError does not apply and the top-level catch
      // must route this to EXIT_INTERNAL (4).
      expect(r.status, r.stdout + r.stderr).toBe(4);
      // stderr should use the programmer-bug wording, not the generic
      // "internal error" one.
      expect(r.stderr).toMatch(/bug \(programmer error\)/);
    } finally {
      fs.rmSync(preload, { recursive: true, force: true });
    }
  });
});

describe("UnreadableDirError", () => {
  it("carries the dir and a human-readable message", () => {
    const cause = new Error("EACCES: permission denied");
    const e = new UnreadableDirError("/tmp/packages", cause);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("UnreadableDirError");
    expect(e.dir).toBe("/tmp/packages");
    expect(e.message).toMatch(/^could not read \/tmp\/packages: EACCES/);
    // ES2022 cause chain preserves the original ErrnoException so
    // callers can still reach `.code` / `.errno` / `.syscall`.
    expect((e as Error & { cause?: unknown }).cause).toBe(cause);
  });

  it("is thrown by listShowcasePackageSlugs when readdirSync fails", () => {
    // Verify the error is raised at the right control-flow point:
    // listShowcasePackageSlugs catches fs failures and rethrows as
    // UnreadableDirError carrying the exact packages dir it tried.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-unreadable-"));
    try {
      const cfg = {
        packagesDir: path.join(root, "does-not-exist"),
        examplesIntegrationsDir: path.join(root, "examples", "integrations"),
        repoRoot: root,
      };
      let thrown: unknown = null;
      try {
        listShowcasePackageSlugs(cfg);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(UnreadableDirError);
      const e = thrown as UnreadableDirError;
      expect(e.dir).toBe(cfg.packagesDir);
      expect(e.message).toContain(cfg.packagesDir);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves the non-Error cause via String() coercion in the message", () => {
    // Defensive: an fs layer could, in principle, reject with a
    // non-Error value. UnreadableDirError still produces a readable
    // message via String(cause).
    const e = new UnreadableDirError("/tmp/x", "bespoke-failure-token");
    expect(e.message).toBe("could not read /tmp/x: bespoke-failure-token");
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

  it("throws UnreadableDirError when packages dir cannot be read", () => {
    const cfg = {
      ...makeConfig(root),
      packagesDir: path.join(root, "nope"),
    };
    // Missing dir → readdirSync ENOENT → UnreadableDirError. Previously
    // the code returned [] and main() collapsed this to "exit 1 (empty
    // packages)", masking a real I/O failure.
    expect(() => listShowcasePackageSlugs(cfg)).toThrow(UnreadableDirError);
  });
});

describe("auditPackage — direct-caller invariants", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpTree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("anomalies and warnings arrays are frozen on the audit returned by auditPackage (before buildReport)", () => {
    // Regression guard: previously the arrays were only frozen inside
    // buildReport, so direct callers of auditPackage saw unfrozen arrays
    // and could mutate them.
    writePackage(root, "direct", {
      manifest: `slug: direct\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    makeExampleDir(root, "direct");
    const cfg = makeConfig(root);
    const a = auditPackage("direct", cfg);
    expect(Object.isFrozen(a.anomalies)).toBe(true);
    expect(Object.isFrozen(a.warnings)).toBe(true);
  });

  it("Anomaly.not-deployed.state distinguishes 'unset' from 'explicit-false'", () => {
    writePackage(root, "unsetreal", {
      manifest: `slug: unsetreal\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    makeExampleDir(root, "unsetreal");
    writePackage(root, "falsereal", {
      manifest: `slug: falsereal\ndeployed: false\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    makeExampleDir(root, "falsereal");
    const cfg = makeConfig(root);
    const a = auditPackage("unsetreal", cfg);
    const b = auditPackage("falsereal", cfg);
    const aNot = a.anomalies.find(
      (x): x is Extract<Anomaly, { kind: "not-deployed" }> =>
        x.kind === "not-deployed",
    );
    const bNot = b.anomalies.find(
      (x): x is Extract<Anomaly, { kind: "not-deployed" }> =>
        x.kind === "not-deployed",
    );
    expect(aNot).toBeDefined();
    expect(bNot).toBeDefined();
    // Self-documenting string union — callers read the raw boolean off
    // the manifest variant when they need the original value.
    expect(aNot!.state).toBe("unset");
    expect(bNot!.state).toBe("explicit-false");
  });

  it("Object.freeze on manifest.manifest also freezes the demos array and each demo", () => {
    writePackage(root, "frozendemos", {
      manifest: `slug: frozendemos\ndeployed: true\ndemos:\n  - id: a\n  - id: b\n`,
      specs: ["a.spec.ts", "b.spec.ts"],
      qaFiles: ["a.md", "b.md"],
    });
    makeExampleDir(root, "frozendemos");
    const cfg = makeConfig(root);
    const report = buildReport(["frozendemos"], cfg);
    const p = report.packages[0];
    expect(p.manifest.kind).toBe("ok");
    if (p.manifest.kind === "ok") {
      const demos = p.manifest.manifest.demos!;
      expect(Object.isFrozen(demos)).toBe(true);
      for (const d of demos) {
        expect(Object.isFrozen(d)).toBe(true);
      }
    }
  });

  it("if ALL mapped candidates fail with unreadable errors, push a CRITICAL warning to the sink", () => {
    // The slug has multiple candidates — inject statSync failures for
    // every candidate so the function exhausts all options.
    const slug = "langgraph-typescript"; // mapped
    const mapped = SLUG_TO_EXAMPLES[slug];
    expect(mapped).toBeDefined();
    // Create dirs for each candidate so existsSync succeeds (and we
    // reach statSync where we inject).
    for (const c of mapped!) makeExampleDir(root, c);
    const targets = new Set(
      mapped!.map((c) => path.join(root, "examples", "integrations", c)),
    );
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && targets.has(p)) {
        const e: NodeJS.ErrnoException = new Error("EACCES: injected");
        e.code = "EACCES";
        throw e;
      }
      return (orig as unknown as (p: fs.PathLike, o?: unknown) => unknown)(
        p,
        options,
      );
    }) as typeof fs.statSync);
    try {
      const cfg = makeConfig(root);
      const sink: string[] = [];
      const r = findExamplesSource(slug, cfg, sink);
      expect(r).toBeNull();
      // A critical "all candidates unreadable" message must appear.
      expect(sink.some((w) => /ERROR/.test(w))).toBe(true);
      expect(sink.some((w) => w.includes(slug))).toBe(true);
      expect(sink.some((w) => /unreadable/.test(w))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("buildReport — scalar summary fields", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpTree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("hasWarnings reflects whether any package has warnings", () => {
    // A package whose mapped dir is missing emits a stale-mapping warning.
    const mappedSlug = Object.keys(SLUG_TO_EXAMPLES)[0];
    writePackage(root, mappedSlug, {
      manifest: `slug: ${mappedSlug}\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    const cfg = makeConfig(root);
    const report = buildReport([mappedSlug], cfg);
    expect(report.hasWarnings).toBe(true);

    // And a clean package — no warnings.
    writePackage(root, "clean", {
      manifest: `slug: clean\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    makeExampleDir(root, "clean");
    const clean = buildReport(["clean"], cfg);
    expect(clean.hasWarnings).toBe(false);
  });
});

describe("parseArgs — --strict and --columns", () => {
  it("parses --strict flag", () => {
    const r = parseArgs(["--strict"]);
    expect(r.strict).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("--strict defaults to false", () => {
    const r = parseArgs([]);
    expect(r.strict).toBe(false);
  });

  it("parses --columns=a,b,c into an array of column keys", () => {
    const r = parseArgs(["--columns=slug,demos,deployed"]);
    expect(r.columns).toEqual(["slug", "demos", "deployed"]);
    expect(r.errors).toEqual([]);
  });

  it("rejects unknown column keys in --columns", () => {
    const r = parseArgs(["--columns=slug,bogus"]);
    expect(r.errors.some((e) => /bogus/.test(e))).toBe(true);
  });
});

describe("computeExitCode — --strict semantics", () => {
  it("anomalies present → exit 1 regardless of strict/warnings", () => {
    expect(
      computeExitCode({
        hasAnomalies: true,
        hasWarnings: false,
        strict: false,
      }),
    ).toBe(1);
    expect(
      computeExitCode({ hasAnomalies: true, hasWarnings: true, strict: false }),
    ).toBe(1);
    expect(
      computeExitCode({ hasAnomalies: true, hasWarnings: true, strict: true }),
    ).toBe(1);
  });

  it("no anomalies, warnings, default → exit 0 (default preserves current behavior)", () => {
    expect(
      computeExitCode({
        hasAnomalies: false,
        hasWarnings: true,
        strict: false,
      }),
    ).toBe(0);
  });

  it("no anomalies, warnings, --strict → exit 5", () => {
    expect(
      computeExitCode({ hasAnomalies: false, hasWarnings: true, strict: true }),
    ).toBe(5);
  });

  it("no anomalies, no warnings, --strict → exit 0 (strict only elevates when warnings exist)", () => {
    expect(
      computeExitCode({
        hasAnomalies: false,
        hasWarnings: false,
        strict: true,
      }),
    ).toBe(0);
  });

  it("no anomalies, no warnings, default → exit 0", () => {
    expect(
      computeExitCode({
        hasAnomalies: false,
        hasWarnings: false,
        strict: false,
      }),
    ).toBe(0);
  });
});

describe("buildReport — --strict exit code", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpTree();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("clean report with no warnings exits 0 regardless of --strict", () => {
    // A fully clean package: manifest ok, deployed:true, counts match,
    // examples dir present, and the slug is born-in-showcase so
    // findExamplesSource is not consulted → no warnings, no anomalies.
    const slug = "ag2"; // born-in-showcase → no SLUG_TO_EXAMPLES lookup
    writePackage(root, slug, {
      manifest: `slug: ${slug}\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    const cfg = makeConfig(root);

    const relaxed = buildReport([slug], cfg);
    expect(relaxed.hasWarnings).toBe(false);
    expect(relaxed.hasAnomalies).toBe(false);
    expect(relaxed.exitCode).toBe(0);

    const strict = buildReport([slug], cfg, { strict: true });
    expect(strict.hasWarnings).toBe(false);
    expect(strict.hasAnomalies).toBe(false);
    expect(strict.exitCode).toBe(0);
  });

  it("--strict with warnings-only (no anomalies) exits 5 (EXIT_WARNINGS)", () => {
    // Construct the warnings-only quadrant deterministically by
    // driving findExamplesSource into the "all-candidates-unreadable"
    // path: mapped slug whose candidates exist on disk but whose
    // statSync throws for each — findExamplesSource returns null AND
    // pushes a CRITICAL warning onto the sink. auditPackage would
    // also push a missing-examples anomaly unless the slug is in
    // BORN_IN_SHOWCASE. To avoid that anomaly while keeping the
    // warning, we mock SLUG_TO_EXAMPLES-driven behavior on a
    // born-in-showcase slug — impossible since BORN_IN_SHOWCASE is
    // the set of slugs without mappings.
    //
    // Instead, drive the warnings-only path by mocking statSync so
    // findExamplesSource SUCCEEDS (dir statSync returns isDirectory)
    // AND a warning is pushed to the sink. We achieve that by
    // creating both candidates and forcing a stat failure on a LATER
    // candidate while the FIRST resolves successfully:
    //   - candidates[0] exists → returns path (no anomaly)
    //   - but we first make the loop visit a pre-existing failing
    //     candidate by creating it under the wrong name? No —
    //     findExamplesSource iterates declared order and returns on
    //     first match.
    //
    // Simpler deterministic route: mock fs.statSync once so the first
    // candidate's stat throws EIO (pushing a statSync warning) AND the
    // statSync-catch `continue` then finds no later candidate → returns
    // null → missing-examples anomaly appears for non-BORN slugs.
    //
    // The cleanest deterministic warnings-only setup uses TWO packages:
    // one born-in-showcase clean package plus a second package we mock
    // to push a warning through findExamplesSource's sink without
    // producing an anomaly. Since the anomaly-vs-warning coupling
    // makes this hard to produce organically, we verify the --strict
    // exit-code path directly via computeExitCode AND confirm that
    // when BOTH warnings and anomalies coexist, --strict does NOT
    // downgrade the anomaly exit code.
    const slug = "mastra"; // mapped, missing dir → warning + anomaly
    writePackage(root, slug, {
      manifest: `slug: ${slug}\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    const cfg = makeConfig(root);
    const report = buildReport([slug], cfg, { strict: true });
    // Sanity: warnings AND anomalies both present in this path.
    expect(report.hasWarnings).toBe(true);
    expect(report.hasAnomalies).toBe(true);
    // Anomaly exit wins over warnings exit (contract of computeExitCode).
    expect(report.exitCode).toBe(1);

    // Directly verify the warnings-only + strict exit path at the
    // pure level (covered already in computeExitCode suite but
    // asserted here for co-located clarity of the --strict contract).
    expect(
      computeExitCode({
        hasAnomalies: false,
        hasWarnings: true,
        strict: true,
      }),
    ).toBe(5);
    expect(
      computeExitCode({
        hasAnomalies: false,
        hasWarnings: true,
        strict: false,
      }),
    ).toBe(0);
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
    // output must NOT include those labels.
    expect(r.stdout).toContain("slug");
    expect(r.stdout).toContain("demos");
    expect(r.stdout).not.toContain("examples src");
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
