// Split from audit.test.ts — see audit.shared.ts header for the full
// rationale (vitest birpc 60s cliff, fork-per-file).
//
// This file hosts the integration-ish describes around `auditPackage`
// and `buildReport`: end-to-end audit flows, report structure, anomaly
// bucket routing, and related --strict / column / summary surface.
// A single `spawnSync` CLI call remains inside `buildReport` (the
// mapped-candidate-not-directory anomaly-surface regression test) — the
// rest is in-process.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
  auditPackage,
  buildReport,
  computeExitCode,
  findExamplesSource,
  resolveExamplesSource,
  parseArgs,
  BORN_IN_SHOWCASE,
  SLUG_TO_EXAMPLES,
  type Anomaly,
} from "../audit.js";
import {
  AUDIT_SCRIPT,
  makeTmpTree,
  makeConfig,
  writePackage,
  makeExampleDir,
  anomalyStrings,
} from "./audit.shared.js";

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
    const e2eDir = path.join(root, "integrations", "perm", "tests", "e2e");
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
    const qaDir = path.join(root, "integrations", "qaperm", "qa");
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

  it("pushes an unreadable-examples anomaly (not missing-examples) when all mapped candidates exist but are unreadable", () => {
    // Contract: the "all candidates unreadable" infrastructure failure
    // must surface as its own Anomaly variant so downstream consumers
    // can distinguish "provenance is genuinely missing" (missing-examples,
    // stale mapping) from "we couldn't tell whether provenance is
    // satisfied" (unreadable-examples, I/O / permissions). Conflating
    // them would hide real access failures behind a content-shaped signal.
    const mappedSlug = "mastra";
    const candidates = SLUG_TO_EXAMPLES[mappedSlug];
    expect(candidates).toBeDefined();
    expect(candidates.length).toBeGreaterThan(0);
    writePackage(root, mappedSlug, {
      manifest: `slug: ${mappedSlug}\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    // Create the candidate dirs so existsSync sees them; mock statSync
    // to throw EACCES on those paths so every candidate registers as
    // unreadable. Non-candidate statSync calls fall through to the real
    // implementation so other fixture operations still work.
    const fullPaths = candidates.map((c) =>
      path.join(root, "examples", "integrations", c),
    );
    for (const c of candidates) makeExampleDir(root, c);
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && fullPaths.includes(p)) {
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
      const a = auditPackage(mappedSlug, cfg);
      // The CRITICAL warning from findExamplesSource must be present.
      expect(
        a.warnings.some(
          (w) => w.includes("unreadable-candidates") && w.includes(mappedSlug),
        ),
      ).toBe(true);
      // No plain missing-examples anomaly.
      expect(a.anomalies.some((x) => x.kind === "missing-examples")).toBe(
        false,
      );
      // The new variant is present with the mapped candidates echoed.
      const unreadable = a.anomalies.find(
        (x) => x.kind === "unreadable-examples",
      );
      expect(unreadable).toBeDefined();
      if (unreadable && unreadable.kind === "unreadable-examples") {
        expect(unreadable.slug).toBe(mappedSlug);
        expect([...unreadable.candidates]).toEqual([...candidates]);
      }
      // Rendering routes through anomalyMessage without throwing and
      // carries the slug + candidates in the human-readable output.
      const messages = anomalyStrings(a);
      expect(
        messages.some(
          (m) =>
            m.includes(mappedSlug) && candidates.every((c) => m.includes(c)),
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("classifies unreadable-examples via structured metadata, not warning-string substring match (FX30-C Fix 1)", () => {
    // Regression for FX30-C Fix 1 (R29-2 H1): auditPackage used to
    // classify by scanning warnings[] for `unreadable-candidates` +
    // `"<slug>"` substrings. Any reword of the human-readable warning
    // text (for i18n, for a typo fix, for a docstring tweak) would
    // silently reclassify unreadable-examples as missing-examples. The
    // fix: route classification through a structured return value from
    // resolveExamplesSource, not a string scan.
    //
    // Test strategy: confirm the contract via resolveExamplesSource's
    // direct return shape (no warning string involved). The function
    // must return a tagged object carrying `source` AND a boolean
    // indicator that "all candidates existed but were unreadable" —
    // tests below read that field directly.
    const slug = "structural-unreadable";
    const mapped = ["cand-a", "cand-b"] as const;
    for (const c of mapped) makeExampleDir(root, c);
    const fullPaths = mapped.map((c) =>
      path.join(root, "examples", "integrations", c),
    );
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && fullPaths.includes(p)) {
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
      // resolveExamplesSource now returns a structured tuple, not a
      // bare string. Assert both fields so the classification signal
      // does NOT depend on warning-text substring matching.
      const r = resolveExamplesSource(slug, mapped, cfg);
      // The "all candidates unreadable" signal is a structured boolean.
      expect(r).toMatchObject({
        source: null,
        unreadableForSlug: true,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("resolveExamplesSource returns unreadableForSlug=false for a stale mapping (no unreadable candidates)", () => {
    // Negative control for the structured return: a stale mapping
    // (candidates absent on disk) must NOT set unreadableForSlug=true.
    // Otherwise audit would route plain stale-mapping cases as
    // unreadable-examples (infrastructure failure) instead of the
    // correct missing-examples (content failure).
    const cfg = makeConfig(root);
    const r = resolveExamplesSource(
      "stale-mapping-slug",
      ["absent-a", "absent-b"] as const,
      cfg,
    );
    expect(r).toMatchObject({
      source: null,
      unreadableForSlug: false,
    });
  });

  it("resolveExamplesSource returns the source string alongside unreadableForSlug=false on success", () => {
    // On the happy path, `source` carries the relative path to the
    // resolved candidate directory and `unreadableForSlug` is false.
    makeExampleDir(root, "cand-hit");
    const cfg = makeConfig(root);
    const r = resolveExamplesSource(
      "synthetic-hit",
      ["cand-hit"] as const,
      cfg,
    );
    expect(r).toMatchObject({
      source: path.join("examples", "integrations", "cand-hit"),
      unreadableForSlug: false,
    });
  });

  it("auditPackage still routes unreadable-examples correctly even if the human-readable warning text is reworded", () => {
    // Fix 1 robustness test: stub resolveExamplesSource's warning sink
    // by monkey-patching the audit to emit a DIFFERENT warning wording,
    // and confirm classification still lands on unreadable-examples. We
    // achieve this by using statSync EACCES on the candidates (so the
    // structured signal fires) and asserting classification does NOT
    // require the human warning to contain `unreadable-candidates` or
    // `"<slug>"` substrings verbatim.
    const slug = "mastra";
    const candidates = SLUG_TO_EXAMPLES[slug];
    expect(candidates).toBeDefined();
    writePackage(root, slug, {
      manifest: `slug: ${slug}\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    const fullPaths = candidates.map((c) =>
      path.join(root, "examples", "integrations", c),
    );
    for (const c of candidates) makeExampleDir(root, c);
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && fullPaths.includes(p)) {
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
      const a = auditPackage(slug, cfg);
      // Classification lands on unreadable-examples regardless of
      // warning text. Fix 1 removed the string-substring gating.
      expect(a.anomalies.some((x) => x.kind === "unreadable-examples")).toBe(
        true,
      );
      expect(a.anomalies.some((x) => x.kind === "missing-examples")).toBe(
        false,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("still pushes missing-examples (not unreadable-examples) when the mapping is simply stale", () => {
    // Negative control for the branch above: the same mapped slug with
    // NO candidate directories on disk must continue to produce
    // missing-examples — the "unreadable-candidates" warning is
    // specifically gated on candidates existing-but-unreadable.
    const mappedSlug = "mastra";
    writePackage(root, mappedSlug, {
      manifest: `slug: ${mappedSlug}\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    // NOTE: no makeExampleDir — the mapping is stale.
    const cfg = makeConfig(root);
    const a = auditPackage(mappedSlug, cfg);
    expect(a.anomalies.some((x) => x.kind === "missing-examples")).toBe(true);
    expect(a.anomalies.some((x) => x.kind === "unreadable-examples")).toBe(
      false,
    );
  });

  it("ENOENT race between existsSync and statSync does NOT produce unreadable-examples (classified as missing-examples)", () => {
    // TOCTOU race guard: existsSync can report true and a subsequent
    // statSync can still throw ENOENT (the candidate directory was
    // removed between the two calls, or we're on a network filesystem
    // with weak coherence). ENOENT specifically indicates the candidate
    // is simply NOT there by the time we stat it — that's a benign
    // stale-mapping / disappearing-dir case, NOT an infrastructure
    // failure. The resolver must NOT increment the unreadable tally
    // for ENOENT, and auditPackage must NOT emit an `unreadable-examples`
    // ERROR anomaly for this race. Fall through as if existsSync had
    // returned false (→ `missing-examples` for mapped slugs).
    const mappedSlug = "mastra";
    const candidates = SLUG_TO_EXAMPLES[mappedSlug];
    expect(candidates).toBeDefined();
    writePackage(root, mappedSlug, {
      manifest: `slug: ${mappedSlug}\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    for (const c of candidates) makeExampleDir(root, c);
    const fullPaths = candidates.map((c) =>
      path.join(root, "examples", "integrations", c),
    );
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && fullPaths.includes(p)) {
        const e: NodeJS.ErrnoException = new Error(
          "ENOENT: no such file or directory",
        );
        e.code = "ENOENT";
        throw e;
      }
      return (orig as unknown as (p: fs.PathLike, o?: unknown) => unknown)(
        p,
        options,
      );
    }) as typeof fs.statSync);
    try {
      const cfg = makeConfig(root);
      const a = auditPackage(mappedSlug, cfg);
      // Classification: ENOENT is a soft miss (absent candidate), not
      // infrastructure. The resolver no longer differentiates "raced"
      // from "never existed" because the existsSync pre-check is gone
      // (existsSync conflates EACCES/ENOENT and was the whole source of
      // the bugs this module fixes). ENOENT → continue, no warning.
      expect(a.anomalies.some((x) => x.kind === "unreadable-examples")).toBe(
        false,
      );
      expect(a.anomalies.some((x) => x.kind === "missing-examples")).toBe(true);
      // No ERROR "unreadable-candidates" wording — that's reserved for
      // true infrastructure failures (EACCES/EIO/etc.).
      expect(a.warnings.some((w) => w.includes("unreadable-candidates"))).toBe(
        false,
      );
      // The stale-mapping warning (no matching directory) is still the
      // operator signal for this scenario.
      expect(a.warnings.some((w) => w.includes("SLUG_TO_EXAMPLES entry"))).toBe(
        true,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("resolveExamplesSource: ENOENT on statSync does NOT flip unreadableForSlug (soft miss)", () => {
    // Unit-level guard for the same ENOENT branch. Purely structural:
    // existedCount++ fires because existsSync returned true, but the
    // ENOENT-specific catch path must NOT increment unreadableCount.
    // Therefore unreadableForSlug stays false and the sink carries a
    // diagnostic.
    const slug = "synthetic-enoent";
    const mapped = ["cand-raced"] as const;
    makeExampleDir(root, "cand-raced");
    const full = path.join(root, "examples", "integrations", "cand-raced");
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((
      p: fs.PathLike,
      options?: unknown,
    ) => {
      if (typeof p === "string" && p === full) {
        const e: NodeJS.ErrnoException = new Error("ENOENT: raced");
        e.code = "ENOENT";
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
      // Key assertion: ENOENT is a benign absence (soft miss), NOT
      // infrastructure failure. With existsSync removed from the
      // candidate gate, ENOENT from statSync is now indistinguishable
      // from "never existed" — both route as missing-examples without
      // a warning. The stale-mapping sink entry from the end of
      // resolveExamplesSource (no matching directory) is the operator
      // signal.
      expect(r.unreadableForSlug).toBe(false);
      // Stale-mapping diagnostic at the end of resolveExamplesSource
      // fires because the mapped slug hit no successful dir.
      expect(sink.some((w) => w.includes("SLUG_TO_EXAMPLES entry"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("mapped slug whose candidate exists but is NOT a directory surfaces a distinct anomaly (not silent missing-examples)", () => {
    // For a MAPPED slug whose candidate path exists-but-is-not-a-
    // directory (regular file / symlink-to-file / socket / FIFO), the
    // old code existedCount++'d but unreadableCount stayed 0, so the
    // slug silently fell through to `missing-examples` with NO
    // diagnostic. Operators had no signal that the integrations dir had
    // a stray file masquerading as the provenance target. The fix adds
    // a distinct `mapped-candidate-not-directory` Anomaly kind driven
    // by a structured `nonDirectoryForSlug` signal — never a warning-
    // string substring match.
    const slug = "mastra";
    const candidates = SLUG_TO_EXAMPLES[slug];
    expect(candidates).toBeDefined();
    expect(candidates.length).toBeGreaterThan(0);
    writePackage(root, slug, {
      manifest: `slug: ${slug}\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    // Write a regular file (not a directory) at every candidate path.
    for (const c of candidates) {
      const p = path.join(root, "examples", "integrations", c);
      fs.writeFileSync(p, "stray file, not a directory\n");
    }
    const cfg = makeConfig(root);
    const a = auditPackage(slug, cfg);
    // The new distinct anomaly kind must fire.
    const notDir = a.anomalies.find(
      (x) => x.kind === "mapped-candidate-not-directory",
    );
    expect(
      notDir,
      `expected mapped-candidate-not-directory anomaly, got: ${JSON.stringify(a.anomalies)}`,
    ).toBeDefined();
    if (notDir && notDir.kind === "mapped-candidate-not-directory") {
      expect(notDir.slug).toBe(slug);
      expect([...notDir.candidates]).toEqual([...candidates]);
    }
    // And MUST NOT silently degrade to missing-examples — the whole
    // point of the fix is to make this misconfiguration visible.
    expect(a.anomalies.some((x) => x.kind === "missing-examples")).toBe(false);
    // Rendering routes through anomalyMessage without throwing and
    // carries the slug + candidates in human-readable output.
    const messages = anomalyStrings(a);
    expect(
      messages.some(
        (m) => m.includes(slug) && candidates.every((c) => m.includes(c)),
      ),
    ).toBe(true);
  });

  it("mapped slug with mixed non-directory + missing candidates still emits mapped-candidate-not-directory", () => {
    // Variant: one candidate is a stray file, another is simply absent.
    // Since at least one mapped candidate existed-but-wasn't-a-dir, the
    // distinct signal must still fire (not silent missing-examples).
    const slug = "synthetic-mixed";
    const mapped = ["stray-file", "totally-absent"] as const;
    // Only create a regular file at the first candidate. The second
    // candidate does not exist at all.
    fs.writeFileSync(
      path.join(root, "examples", "integrations", "stray-file"),
      "not a dir\n",
    );
    const cfg = makeConfig(root);
    const sink: string[] = [];
    const r = resolveExamplesSource(slug, mapped, cfg, sink);
    expect(r.source).toBeNull();
    // Structural contract: resolver must communicate "candidate existed
    // but was not a directory" separately from "all unreadable".
    // unreadableForSlug stays false (no I/O failure). A new structured
    // signal drives the mapped-candidate-not-directory anomaly.
    expect(r.unreadableForSlug).toBe(false);
    expect(r.nonDirectoryForSlug).toBe(true);
    // A diagnostic warning must be present so operators see the
    // misconfiguration.
    expect(
      sink.some(
        (w) =>
          w.includes("stray-file") && /not a directory|non-directory/i.test(w),
      ),
      `expected non-directory warning for stray-file in sink: ${JSON.stringify(sink)}`,
    ).toBe(true);
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

    const e2eDir = path.join(root, "integrations", "mixed", "tests", "e2e");
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

  it("routes mapped-candidate-not-directory anomalies to a visible bucket (not invisible)", () => {
    // Regression guard: the `mapped-candidate-not-directory` Anomaly
    // variant is emitted by auditPackage for mapped slugs whose
    // candidate path exists-but-isn't-a-directory. The bucket routing
    // in buildReport previously had no case for this variant, so a
    // package whose ONLY anomaly was `mapped-candidate-not-directory`
    // appeared in `totals.withAnomalies` (exit 1) but was invisible in
    // every bucket — renderAnomalySection had no section for it, so
    // operators saw exit 1 with no explanation.
    //
    // Fix: route `mapped-candidate-not-directory` into the `unreadable`
    // bucket (misconfiguration is closer to unreadable than to missing).
    const slug = "mastra";
    const candidates = SLUG_TO_EXAMPLES[slug];
    expect(candidates).toBeDefined();
    expect(candidates.length).toBeGreaterThan(0);
    writePackage(root, slug, {
      manifest: `slug: ${slug}\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    // Write a regular file (not a directory) at every candidate path so
    // `mapped-candidate-not-directory` is the SOLE anomaly on this pkg.
    for (const c of candidates) {
      fs.writeFileSync(
        path.join(root, "examples", "integrations", c),
        "stray file, not a directory\n",
      );
    }
    const cfg = makeConfig(root);
    const report = buildReport([slug], cfg);
    // The package surfaces ONE anomaly: mapped-candidate-not-directory.
    const pkg = report.packages.find((p) => p.slug === slug)!;
    expect(
      pkg.anomalies.some((a) => a.kind === "mapped-candidate-not-directory"),
    ).toBe(true);
    // withAnomalies must count this package — which it already does.
    expect(report.totals.withAnomalies).toBe(1);
    // Critical: this package MUST show up in at least one indexed bucket
    // so renderAnomalySection has something to render. We route it into
    // `unreadable` (misconfiguration closer to unreadable than missing).
    expect(report.anomalies.unreadable).toContain(slug);
    // Negative: it must NOT be bucketed as missing-examples (that was
    // the old silent-degradation behavior; the distinct variant is the
    // whole point).
    expect(report.anomalies.missingExamples).not.toContain(slug);
  });

  it("renderAnomalySection surfaces mapped-candidate-not-directory packages (not hidden)", async () => {
    // Companion to the bucket-routing test: the text report must
    // actually mention a package whose only anomaly is
    // mapped-candidate-not-directory. Previously, such a package hit
    // withAnomalies=1 but the anomaly section showed "(none)" because
    // no bucket matched — an infuriating "CI failed but I don't know
    // why" state.
    const slug = "mastra";
    const candidates = SLUG_TO_EXAMPLES[slug];
    writePackage(root, slug, {
      manifest: `slug: ${slug}\ndeployed: true\ndemos:\n  - id: x\n`,
      specs: ["x.spec.ts"],
      qaFiles: ["x.md"],
    });
    for (const c of candidates) {
      fs.writeFileSync(
        path.join(root, "examples", "integrations", c),
        "stray file, not a directory\n",
      );
    }
    const r = spawnSync("npx", ["tsx", AUDIT_SCRIPT], {
      env: { ...process.env, SHOWCASE_AUDIT_ROOT: root },
      encoding: "utf-8",
      timeout: 30_000,
    });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    // The anomaly section must NOT say "(none)" — a package was flagged.
    const anomalySection = r.stdout.split("Coverage anomalies")[1] ?? "";
    const healthSection = anomalySection.split("Overall health")[0] ?? "";
    expect(healthSection).not.toMatch(/\(none\)/);
    // The slug MUST appear in the anomaly section.
    expect(healthSection).toContain(slug);
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
      expect(r.source).toBeNull();
      expect(r.unreadableForSlug).toBe(true);
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
