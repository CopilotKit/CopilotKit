// Split from audit.test.ts — see audit.shared.ts header for the full
// rationale (vitest birpc 60s cliff, fork-per-file).
//
// This file hosts the pure-unit describes that don't spawn the CLI and
// don't exercise the `auditPackage`/`buildReport` integration surface:
// manifest parsing, count helpers, findExamplesSource, parseArgs, small
// module constants (BORN_IN_SHOWCASE, SLUG_TO_EXAMPLES), and assorted
// utility classes (UnreadableDirError, canonicalizeForIsMain,
// listShowcasePackageSlugs).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  auditPackage,
  buildReport,
  listShowcasePackageSlugs,
  readManifest,
  countFiles,
  findExamplesSource,
  resolveExamplesSource,
  isProgrammerBug,
  parseArgs,
  UnreadableDirError,
  canonicalizeForIsMain,
  BORN_IN_SHOWCASE,
  SLUG_TO_EXAMPLES,
  type Anomaly,
} from "../audit.js";
import {
  makeTmpTree,
  makeConfig,
  writePackage,
  makeExampleDir,
} from "./audit.shared.js";

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

  it("surfaces { state: 'unreadable' } (not 'missing') when statSync throws EACCES", () => {
    // Regression guard: the old implementation gated on `fs.existsSync`,
    // which returns false for EACCES/EPERM/EIO/ELOOP/ENOTDIR just like it
    // does for ENOENT. That silently classified unreadable dirs as
    // `missing` (legitimate zero) and triggered phantom count-mismatch
    // anomalies. The fix replaces existsSync with a statSync + errno
    // branch so non-ENOENT stat failures surface as `unreadable`.
    const d = path.join(root, "eacces-stat");
    fs.mkdirSync(d);
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === d) {
        const e: NodeJS.ErrnoException = new Error(
          "EACCES: permission denied (statSync)",
        );
        e.code = "EACCES";
        throw e;
      }
      return (orig as unknown as (p: fs.PathLike, o?: unknown) => unknown)(
        p,
        options,
      );
    }) as typeof fs.statSync);
    try {
      const r = countFiles(d, (n) => n.endsWith(".spec.ts"));
      // MUST NOT collapse to `missing` — operator needs the unreadable
      // signal so downstream auditPackage emits `unreadable-dir` instead
      // of a phantom count-mismatch on a zero count.
      expect(r.state).toBe("unreadable");
      if (r.state === "unreadable") {
        expect(r.error).toContain("EACCES");
      }
    } finally {
      spy.mockRestore();
    }
  });
});
describe("auditPackage — EACCES on spec dir stat → unreadable-dir anomaly (not count-mismatch)", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpTree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("EACCES on statSync of tests/e2e → unreadable-dir anomaly, no phantom count-mismatch", () => {
    // End-to-end: when the e2e dir's stat fails with EACCES, the package
    // must surface an `unreadable-dir` anomaly — NOT a `count-mismatch`
    // claiming 0 specs against declared demos. Previously the existsSync
    // gate in countFiles collapsed EACCES to `missing` (count=0), which
    // then compared unequal against demos and fired a phantom mismatch.
    writePackage(root, "eacces-e2e", {
      manifest: `slug: eacces-e2e\ndeployed: true\ndemos:\n  - id: a\n`,
      specs: ["a.spec.ts"],
      qaFiles: ["a.md"],
    });
    const e2eDir = path.join(root, "packages", "eacces-e2e", "tests", "e2e");
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === e2eDir) {
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
      const a = auditPackage("eacces-e2e", cfg);
      // unreadable-dir anomaly MUST surface with an error containing EACCES.
      const unreadable = a.anomalies.find(
        (x): x is Extract<Anomaly, { kind: "unreadable-dir" }> =>
          x.kind === "unreadable-dir",
      );
      expect(
        unreadable,
        `expected unreadable-dir anomaly, got: ${JSON.stringify(a.anomalies)}`,
      ).toBeDefined();
      if (unreadable) {
        expect(unreadable.error).toContain("EACCES");
      }
      // MUST NOT fire a phantom spec count-mismatch (unreadable !== zero).
      const specMismatch = a.anomalies.find(
        (x): x is Extract<Anomaly, { kind: "count-mismatch" }> =>
          x.kind === "count-mismatch" && x.dimension === "spec",
      );
      expect(specMismatch).toBeUndefined();
      // spec CountState must be "unreadable" (not "missing").
      expect(a.spec.state).toBe("unreadable");
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

  it("returns null source when no candidate directory exists", () => {
    const cfg = makeConfig(root);
    const r = findExamplesSource("does-not-exist", cfg);
    expect(r.source).toBeNull();
    expect(r.unreadableForSlug).toBe(false);
  });

  it("returns relative path when a candidate dir exists", () => {
    makeExampleDir(root, "crewai-crews");
    const cfg = makeConfig(root);
    const r = findExamplesSource("crewai-crews", cfg);
    expect(r.source).toBe(
      path.join("examples", "integrations", "crewai-crews"),
    );
    expect(r.unreadableForSlug).toBe(false);
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
      expect(r.source).toBeNull();
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
    expect(r.source).toBeNull();
    expect(r.unreadableForSlug).toBe(false);
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
    expect(r.source).toBeNull();
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
      expect(r.source).toBeNull();
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
    expect(r.source).toBe(path.join("examples", "integrations", first));
    expect(r.unreadableForSlug).toBe(false);
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
    expect(r.source).toBe(path.join("examples", "integrations", "real-later"));
    expect(r.unreadableForSlug).toBe(false);
  });

  it("warns and returns null when an unmapped slug's candidate path exists but is a regular file", () => {
    // An unmapped slug whose candidate path resolves to a regular file
    // (stray file in examples/integrations, or a name collision) must
    // warn rather than return null silently — operators need a signal
    // that a seemingly-present path was skipped. The warning wording
    // ("exists but is not a directory") is distinct from the
    // mapped-entry "no matching directory" warning so the two
    // misconfiguration modes stay disambiguable.
    const slug = "unmapped-file-slug";
    // Write a regular file at examples/integrations/<slug> (no mkdir).
    const full = path.join(root, "examples", "integrations", slug);
    fs.writeFileSync(full, "not a directory\n");
    const cfg = makeConfig(root);
    const sink: string[] = [];
    // mapped = undefined exercises the unmapped-slug branch.
    const r = resolveExamplesSource(slug, undefined, cfg, sink);
    expect(r.source).toBeNull();
    expect(r.unreadableForSlug).toBe(false);
    expect(
      sink.some(
        (w) => w.includes("exists but is not a directory") && w.includes(full),
      ),
      `expected file-not-dir warning for ${full} in sink: ${JSON.stringify(
        sink,
      )}`,
    ).toBe(true);
    // Must NOT fire the mapped-entry "no matching directory" warning —
    // the fallback path is explicitly not a mapping.
    expect(sink.some((w) => w.includes("SLUG_TO_EXAMPLES entry"))).toBe(false);
  });

  it("EACCES on existsSync does NOT silently skip mapped candidate (routes to unreadableForSlug)", () => {
    // Regression guard: the old implementation used `fs.existsSync` to
    // pre-filter candidates. existsSync returns false for EACCES just
    // like it does for ENOENT, so a candidate whose parent dir is
    // unreadable was silently skipped — not counted in `existedCount`,
    // not counted in `unreadableCount`. When ALL mapped candidates were
    // EACCES'd, the resolver returned `unreadableForSlug: false` and the
    // package silently fell through to `missing-examples`.
    //
    // Fix: replace existsSync with a statSync inside try/catch. ENOENT →
    // continue (absent); EACCES/other errno → increment unreadableCount
    // and push diagnostic. Result: unreadableForSlug is truthy when every
    // mapped candidate is EACCES'd.
    const slug = "synthetic-eacces";
    const mapped = ["only-cand"] as const;
    // Do NOT create the candidate path on disk. Mock existsSync so the
    // old code path would see false (as if ENOENT), while statSync is
    // configured to throw EACCES for the candidate path — which is the
    // signal the fixed code must use.
    const full = path.join(root, "examples", "integrations", "only-cand");
    const origExists = fs.existsSync;
    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation(((
      p: fs.PathLike,
    ) => {
      if (typeof p === "string" && p === full) {
        // Simulate existsSync hiding EACCES as false — the very bug we
        // are guarding against.
        return false;
      }
      return (origExists as (p: fs.PathLike) => boolean)(p);
    }) as typeof fs.existsSync);
    const origStat = fs.statSync;
    const statSpy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === full) {
        const e: NodeJS.ErrnoException = new Error("EACCES: parent unreadable");
        e.code = "EACCES";
        throw e;
      }
      return (origStat as unknown as (p: fs.PathLike, o?: unknown) => unknown)(
        p,
        options,
      );
    }) as typeof fs.statSync);
    try {
      const cfg = makeConfig(root);
      const sink: string[] = [];
      const r = resolveExamplesSource(slug, mapped, cfg, sink);
      // MUST classify as unreadableForSlug — the operator needs the
      // infrastructure-failure signal instead of the benign
      // missing-examples classification.
      expect(r.source).toBeNull();
      expect(r.unreadableForSlug).toBe(true);
      // A diagnostic must land on the sink so the EACCES is not silent.
      expect(sink.some((w) => w.includes("EACCES"))).toBe(true);
    } finally {
      existsSpy.mockRestore();
      statSpy.mockRestore();
    }
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
    expect(r.source).toBe(path.join("examples", "integrations", "first-dir"));
    expect(r.unreadableForSlug).toBe(false);
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

  it("every BORN_IN_SHOWCASE slug has no counterpart directory under examples/integrations/ (fixture-synthesized invariant)", () => {
    // Fixture-based version of the real-repo invariant: synthesize a
    // tmpdir that mimics examples/integrations/ containing only the
    // slugs that SHOULD be there (i.e. nothing from BORN_IN_SHOWCASE).
    // This always runs in CI — no `if (!fs.existsSync) return;` bail.
    //
    // The invariant asserted: given a clean examples/integrations/
    // tree that contains no BORN_IN_SHOWCASE slugs, findExamplesSource
    // must return null for every BORN_IN_SHOWCASE member. If someone
    // later adds a BORN_IN_SHOWCASE slug to SLUG_TO_EXAMPLES by mistake
    // this test will fail via the second assertion.
    const tmp = makeTmpTree();
    try {
      // Seed a handful of non-born slugs so the examples dir isn't empty.
      makeExampleDir(tmp, "mastra");
      makeExampleDir(tmp, "agno");
      const cfg = makeConfig(tmp);
      for (const slug of BORN_IN_SHOWCASE) {
        // No dir created for this slug — findExamplesSource must return
        // a null source and SLUG_TO_EXAMPLES must not carry a mapping
        // for it.
        const r = findExamplesSource(slug, cfg);
        expect(
          r.source,
          `BORN_IN_SHOWCASE slug "${slug}" resolved to a non-null examples source — the maps are inconsistent`,
        ).toBeNull();
        expect(
          SLUG_TO_EXAMPLES[slug],
          `BORN_IN_SHOWCASE slug "${slug}" appears in SLUG_TO_EXAMPLES — remove one or the other`,
        ).toBeUndefined();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
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

  it("every mapped target resolves when its examples/integrations/ dir is present (fixture-synthesized)", () => {
    // Fixture-based dead-entry guard: synthesize an examples/integrations/
    // tmpdir containing every target named in SLUG_TO_EXAMPLES, then
    // assert findExamplesSource returns a non-null path for each slug.
    // This exercises the positive resolution path deterministically and
    // always runs in CI — no `if (!fs.existsSync) return;` bail.
    //
    // Dead-entry protection: if anyone adds a SLUG_TO_EXAMPLES entry
    // pointing at a non-existent target and the real repo lacks that
    // dir, audit would emit a phantom "no examples source" anomaly.
    // The slug-map.test.ts real-repo invariant (separate file) still
    // enforces the production tree; this test locks in the runtime
    // resolution contract.
    const tmp = makeTmpTree();
    try {
      for (const targets of Object.values(SLUG_TO_EXAMPLES)) {
        for (const target of targets) {
          makeExampleDir(tmp, target);
        }
      }
      const cfg = makeConfig(tmp);
      for (const [slug, targets] of Object.entries(SLUG_TO_EXAMPLES)) {
        const r = findExamplesSource(slug, cfg);
        expect(
          r.source,
          `SLUG_TO_EXAMPLES[${slug}] → [${targets.join(
            ", ",
          )}] failed to resolve against a fixture containing every target`,
        ).not.toBeNull();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
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
    expect(r.source).toBeNull();
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
    expect(r.source).toBeNull();
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
describe("findExamplesSource — unreadable-candidates ERROR branch", () => {
  // Coverage for audit.ts:429-434: when a mapped slug has multiple
  // candidates and ALL of them exist but ALL statSync calls fail, the
  // resolver must emit an ERROR warning (category:
  // unreadable-candidates) and return null. This is materially
  // different from the benign "no matching dir" warning because we
  // can't actually tell whether the provenance is satisfied — the
  // downstream consumer needs the ERROR level to route differently.
  let root: string;
  beforeEach(() => {
    root = makeTmpTree();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits an ERROR (category: unreadable-candidates) when every mapped candidate exists but statSync fails on all of them", () => {
    const slug = "synthetic-unreadable";
    const mapped = ["cand-a", "cand-b"] as const;
    makeExampleDir(root, "cand-a");
    makeExampleDir(root, "cand-b");
    const dirA = path.join(root, "examples", "integrations", "cand-a");
    const dirB = path.join(root, "examples", "integrations", "cand-b");
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && (p === dirA || p === dirB)) {
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
      const r = resolveExamplesSource(slug, mapped, cfg, sink);
      expect(r.source).toBeNull();
      // Structured classification signal: "all candidates unreadable"
      // must surface as unreadableForSlug=true without relying on the
      // human-readable warning wording.
      expect(r.unreadableForSlug).toBe(true);
      // The ERROR warning must be present, tagged with the category,
      // and must name the slug so downstream consumers can route it.
      expect(
        sink.some((w) => /ERROR/.test(w) && w.includes(slug)),
        `expected an ERROR warning for slug "${slug}" in sink: ${JSON.stringify(
          sink,
        )}`,
      ).toBe(true);
      expect(sink.some((w) => w.includes("unreadable-candidates"))).toBe(true);
      // Every candidate should have shown up in a statSync warning too
      // (companion diagnostic emitted from the loop body).
      expect(
        sink.some((w) => w.includes("statSync") && w.includes("cand-a")),
      ).toBe(true);
      expect(
        sink.some((w) => w.includes("statSync") && w.includes("cand-b")),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
describe("isProgrammerBug classification", () => {
  // Coverage for audit.ts:1206-1222. The top-level catch in main()
  // uses isProgrammerBug to decide between "broken invariant, worth a
  // bug report" diagnostic wording and "infrastructure / I/O" wording.
  // Both land on EXIT_INTERNAL but the operator-facing message diverges.
  it("classifies a bare TypeError as a programmer bug", () => {
    expect(isProgrammerBug(new TypeError("invariant broken"))).toBe(true);
  });

  it("classifies ReferenceError and RangeError as programmer bugs too", () => {
    expect(isProgrammerBug(new ReferenceError("x is not defined"))).toBe(true);
    expect(isProgrammerBug(new RangeError("Maximum call stack"))).toBe(true);
  });

  it("classifies a plain Error (no .code) as NOT a programmer bug", () => {
    // A bare Error without `.code` is neither an errno nor one of the
    // recognised programmer-bug subclasses — falls through the guard
    // and returns false.
    expect(isProgrammerBug(new Error("something else"))).toBe(false);
  });

  it("classifies an ErrnoException-shaped Error as NOT a programmer bug", () => {
    // Any Error carrying a string `.code` is treated as runtime I/O —
    // including the rare case where a TypeError also picks up a
    // `.code` field, in which case the errno check wins.
    const e: NodeJS.ErrnoException = new Error("EACCES: permission denied");
    e.code = "EACCES";
    expect(isProgrammerBug(e)).toBe(false);
  });

  it("classifies a TypeError carrying a string .code as NOT a programmer bug (errno wins)", () => {
    // This is the "weird subclass drift" case called out in the
    // comment at audit.ts:1197-1202 — an errno-bearing TypeError is
    // biased toward runtime, not programmer.
    const e = new TypeError("weird drift") as TypeError & { code?: string };
    e.code = "EIO";
    expect(isProgrammerBug(e)).toBe(false);
  });

  it("classifies non-Error values as NOT programmer bugs", () => {
    // Non-Error throws (strings, numbers, plain objects) don't satisfy
    // the `instanceof Error` guard and return false.
    expect(isProgrammerBug("string thrown")).toBe(false);
    expect(isProgrammerBug(42)).toBe(false);
    expect(isProgrammerBug({ message: "plain" })).toBe(false);
    expect(isProgrammerBug(undefined)).toBe(false);
    expect(isProgrammerBug(null)).toBe(false);
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

  it("includes the errno .code in the rendered message when missing from cause.message", () => {
    // Some callers/tests construct Errors that attach .code but do not
    // embed the code in .message. UnreadableDirError surfaces the code
    // in its rendered message so operators see e.g. EACCES immediately.
    const cause = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    const e = new UnreadableDirError("/x", cause);
    expect(e.message).toBe("could not read /x: EACCES: permission denied");
  });

  it("does not double-prepend errno code when already in cause.message", () => {
    // Node's fs errors embed the code in .message (e.g.
    // "EACCES: permission denied, scandir ..."). Avoid "EACCES: EACCES:".
    const cause = Object.assign(
      new Error("EACCES: permission denied, scandir '/x'"),
      { code: "EACCES" },
    );
    const e = new UnreadableDirError("/x", cause);
    expect(e.message).toBe(
      "could not read /x: EACCES: permission denied, scandir '/x'",
    );
    expect(e.message).not.toMatch(/EACCES: EACCES/);
  });
});
describe("canonicalizeForIsMain", () => {
  it("returns a canonical (realpath) path when the file exists", () => {
    // Two distinct input strings that refer to the same underlying file
    // (one absolute, one with a redundant `.` segment) must canonicalize
    // to the same result. This proves the helper normalizes inputs
    // rather than merely passing them through — a stronger invariant
    // than `canonicalize(f) === realpathSync(f)`, which would be
    // trivially true for any pass-through implementation.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-canon-"));
    try {
      const f = path.join(root, "a.txt");
      fs.writeFileSync(f, "x");
      // Same file, two different string forms: plain absolute vs.
      // absolute with a redundant `./` segment injected in the middle.
      // Concatenate directly rather than via path.join (which would
      // collapse `.` eagerly) so the inputs are genuinely distinct at
      // the string level before the helper sees them.
      const plain = f;
      const dotted = `${root}${path.sep}.${path.sep}a.txt`;
      expect(plain).not.toBe(dotted); // sanity: inputs are distinct strings
      const canonPlain = canonicalizeForIsMain(plain);
      const canonDotted = canonicalizeForIsMain(dotted);
      expect(canonPlain).toEqual(canonDotted);
      expect(canonPlain).toEqual({ ok: true, path: fs.realpathSync(f) });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("silently falls back to resolved path on ENOENT (no stderr noise)", () => {
    // Synthetic argv[0] paths produced by some test harnesses don't
    // exist on disk; ENOENT must stay quiet so CI logs aren't polluted.
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const missing = path.join(
        os.tmpdir(),
        "does-not-exist-xyz-" + Date.now(),
      );
      const out = canonicalizeForIsMain(missing);
      expect(out).toEqual({ ok: true, path: path.resolve(missing) });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("returns ok:false with the errno code on non-ENOENT realpath failure", () => {
    // Non-ENOENT realpath failures (EACCES/ELOOP/EIO) indicate genuine
    // filesystem-access problems. The helper now returns a tagged union
    // — `{ ok: false, errno, message, resolved }` — and leaves the exit
    // semantics to the caller (the isMain guard). Importing this module
    // must never terminate the host process, so `canonicalizeForIsMain`
    // never calls `process.exit` itself.
    // Filter by path so tsx / vitest internals that call realpathSync
    // during module resolution or stack-trace symbolication fall
    // through to the real implementation — only the synthetic test
    // path triggers the synthesized failure.
    const origRealpath = fs.realpathSync;
    const realpathSpy = vi.spyOn(fs, "realpathSync").mockImplementation(((
      p: fs.PathLike,
      ...rest: unknown[]
    ) => {
      if (String(p) === "/some/path") {
        throw Object.assign(new Error("I/O error"), { code: "EIO" });
      }
      return (origRealpath as (...a: unknown[]) => string)(p, ...rest);
    }) as unknown as typeof fs.realpathSync);
    try {
      const out = canonicalizeForIsMain("/some/path");
      expect(out).toEqual({
        ok: false,
        errno: "EIO",
        message: "I/O error",
        resolved: path.resolve("/some/path"),
      });
    } finally {
      realpathSpy.mockRestore();
    }
  });

  it("does NOT set process.exitCode on ENOENT fallback", () => {
    // ENOENT is the benign synthetic-argv[0] case — must stay quiet
    // and must NOT leak an exit-code elevation to the surrounding run.
    // Filter by path so only the synthetic test path triggers ENOENT —
    // tsx / vitest internals continue to use the real implementation.
    const origRealpath = fs.realpathSync;
    const realpathSpy = vi.spyOn(fs, "realpathSync").mockImplementation(((
      p: fs.PathLike,
      ...rest: unknown[]
    ) => {
      if (String(p) === "/some/missing/path") {
        throw Object.assign(new Error("no such file"), { code: "ENOENT" });
      }
      return (origRealpath as (...a: unknown[]) => string)(p, ...rest);
    }) as unknown as typeof fs.realpathSync);
    const priorExitCode = process.exitCode;
    process.exitCode = 0;
    try {
      canonicalizeForIsMain("/some/missing/path");
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = priorExitCode;
      realpathSpy.mockRestore();
    }
  });

  it("returns ok:false with EACCES details and does not touch stderr itself", () => {
    // Non-ENOENT realpath failures indicate real problems (permission,
    // loop, I/O). The helper now surfaces the diagnostic data through
    // the returned tuple (`errno`, `message`, `resolved`) and leaves
    // stderr emission + exit semantics to the caller (the isMain guard
    // is what writes the "[canonicalizeForIsMain] realpath failed for
    // ..." line). Importers therefore never see stderr noise.
    // Filter by path so only the synthetic test path raises EACCES —
    // tsx / vitest internals continue to use the real implementation.
    const origRealpath = fs.realpathSync;
    const realpathSpy = vi.spyOn(fs, "realpathSync").mockImplementation(((
      p: fs.PathLike,
      ...rest: unknown[]
    ) => {
      if (String(p) === "/some/path") {
        throw Object.assign(new Error("permission denied"), {
          code: "EACCES",
        });
      }
      return (origRealpath as (...a: unknown[]) => string)(p, ...rest);
    }) as unknown as typeof fs.realpathSync);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const out = canonicalizeForIsMain("/some/path");
      expect(out).toEqual({
        ok: false,
        errno: "EACCES",
        message: "permission denied",
        resolved: path.resolve("/some/path"),
      });
      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      realpathSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("does not crash when a non-Error primitive is thrown by realpathSync", () => {
    // Hardening: e instanceof Error guard prevents
    // `(e as NodeJS.ErrnoException).code` from crashing on primitive
    // throws ("string", number, plain object). The helper treats these
    // as non-ENOENT and returns `ok: false` with a synthesized errno
    // (`UNKNOWN`) plus the stringified throw value as the message.
    // Filter by path so only the synthetic test path throws the raw
    // primitive — tsx / vitest internals continue to use the real impl.
    const origRealpath = fs.realpathSync;
    const realpathSpy = vi.spyOn(fs, "realpathSync").mockImplementation(((
      p: fs.PathLike,
      ...rest: unknown[]
    ) => {
      if (String(p) === "/some/path") {
        // Intentionally throw a non-Error primitive.
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw string failure";
      }
      return (origRealpath as (...a: unknown[]) => string)(p, ...rest);
    }) as unknown as typeof fs.realpathSync);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const out = canonicalizeForIsMain("/some/path");
      expect(out).toEqual({
        ok: false,
        errno: "UNKNOWN",
        message: "raw string failure",
        resolved: path.resolve("/some/path"),
      });
      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      realpathSpy.mockRestore();
      stderrSpy.mockRestore();
    }
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
